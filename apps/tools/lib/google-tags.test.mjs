import test from "node:test";
import assert from "node:assert/strict";

import {
  checkGoogleTags,
  containerUrl,
  googleTagIds,
  googleTagUrl,
} from "../scripts/lib/google-tags.mjs";

// The tag GTM-PP9W77LK's gtm.js held on 2026-10-19 (#346 F1), and the tag
// the owner replaced it with.
const OLD_TAG = '{"function":"__googtag","once_per_event":true,"vtp_tagId":"G-6N5GK54MWY","tag_id":3}';
const NEW_TAG = '{"function":"__googtag","once_per_event":true,"vtp_tagId":"GT-T9CQH2XR","tag_id":3}';

// A fetch that answers each URL from `answers`: a status, [status, body], or
// an Error to throw. It records each request.
function stubFetch(answers) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    const answer = answers[url];
    if (answer === undefined) throw new Error(`unexpected request ${url}`);
    if (answer instanceof Error) throw answer;
    const [status, body] = Array.isArray(answer) ? answer : [answer, ""];
    return new Response(body, { status });
  };
  return { fetch, requests };
}

const container = (body) => ({ [containerUrl("GTM-TEST")]: [200, body] });

test("finds the G-, GT- and AW- ids a container loads, once each", () => {
  const script = [
    OLD_TAG,
    NEW_TAG,
    '"vtp_measurementIdOverride":"G-6N5GK54MWY"',
    '"vtp_conversionId":"AW-1234567890"',
    // Not tag ids: a container id, a bare prefix, an id outside quotes.
    '"GTM-PP9W77LK"',
    'a.indexOf("GT-")',
    "G-ABCDEFGH",
  ].join(",");
  assert.deepEqual(googleTagIds(script), ["G-6N5GK54MWY", "GT-T9CQH2XR", "AW-1234567890"]);
  assert.deepEqual(googleTagIds("no tags here"), []);
});

test("passes when every Google tag answers 200, asking Google with the given headers", async () => {
  const { fetch, requests } = stubFetch({
    ...container(NEW_TAG),
    [googleTagUrl("GT-T9CQH2XR")]: 200,
  });
  const result = await checkGoogleTags("GTM-TEST", {
    fetch,
    timeoutMs: 5000,
    headers: { "user-agent": "smoke" },
  });
  assert.equal(result.state, "passed");
  assert.match(result.message, /GTM-TEST loads GT-T9CQH2XR/);
  assert.deepEqual(result.tags, { "GT-T9CQH2XR": 200 });
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "https://www.googletagmanager.com/gtm.js?id=GTM-TEST",
      "https://www.googletagmanager.com/gtag/js?id=GT-T9CQH2XR",
    ],
  );
  for (const request of requests) {
    assert.equal(request.init.headers["user-agent"], "smoke");
    assert.ok(request.init.signal instanceof AbortSignal);
  }
});

test("fails naming each Google tag that doesn't answer 200", async () => {
  const { fetch } = stubFetch({
    ...container(`${OLD_TAG},${NEW_TAG}`),
    [googleTagUrl("G-6N5GK54MWY")]: 404,
    [googleTagUrl("GT-T9CQH2XR")]: 200,
  });
  const result = await checkGoogleTags("GTM-TEST", { fetch });
  assert.equal(result.state, "failed");
  assert.match(result.message, /G-6N5GK54MWY \(answered 404\)/);
  assert.doesNotMatch(result.message, /GT-T9CQH2XR/);
  assert.deepEqual(result.tags, { "G-6N5GK54MWY": 404, "GT-T9CQH2XR": 200 });
});

test("fails when the container itself doesn't answer 200", async () => {
  const { fetch } = stubFetch({ [containerUrl("GTM-TEST")]: [404, "Not found"] });
  const result = await checkGoogleTags("GTM-TEST", { fetch });
  assert.equal(result.state, "failed");
  assert.match(result.message, /GTM-TEST's gtm.js answered 404/);
});

test("warns, not fails, when Google can't be reached or answers 5xx", async () => {
  const offline = stubFetch({ [containerUrl("GTM-TEST")]: new TypeError("fetch failed") });
  const containerDown = await checkGoogleTags("GTM-TEST", { fetch: offline.fetch });
  assert.equal(containerDown.state, "warning");
  assert.match(containerDown.message, /fetch failed/);

  const tagDown = stubFetch({
    ...container(`${OLD_TAG},${NEW_TAG}`),
    [googleTagUrl("G-6N5GK54MWY")]: 503,
    [googleTagUrl("GT-T9CQH2XR")]: new TypeError("fetch failed"),
  });
  const result = await checkGoogleTags("GTM-TEST", { fetch: tagDown.fetch });
  assert.equal(result.state, "warning");
  assert.match(result.message, /G-6N5GK54MWY \(answered 503\), GT-T9CQH2XR \(fetch failed\)/);
});

test("a tag that answers 404 fails even when another can't be reached", async () => {
  const { fetch } = stubFetch({
    ...container(`${OLD_TAG},${NEW_TAG}`),
    [googleTagUrl("G-6N5GK54MWY")]: 404,
    [googleTagUrl("GT-T9CQH2XR")]: new TypeError("fetch failed"),
  });
  const result = await checkGoogleTags("GTM-TEST", { fetch });
  assert.equal(result.state, "failed");
  assert.match(result.message, /G-6N5GK54MWY/);
});

test("a container with no Google tag passes and says so", async () => {
  const { fetch } = stubFetch(container("{}"));
  const result = await checkGoogleTags("GTM-TEST", { fetch });
  assert.equal(result.state, "passed");
  assert.equal(result.message, "GTM-TEST loads no Google tag");
});

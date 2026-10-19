import test from "node:test";
import assert from "node:assert/strict";

import {
  checkGoogleTags,
  containerResource,
  containerUrl,
  googleTags,
  googleTagUrl,
  FAILURE_HINT,
  outcomeReport,
} from "../scripts/lib/google-tags.mjs";

// Tags shaped as in GTM-PP9W77LK's gtm.js on 2026-10-19: the Google tag before
// H1 on #346 (G-6N5GK54MWY, whose gtag/js answers 404) and after it.
const OLD_GOOGLE_TAG = {
  function: "__googtag",
  metadata: ["map"],
  once_per_event: true,
  vtp_tagId: "G-6N5GK54MWY",
  tag_id: 3,
};
const NEW_GOOGLE_TAG = { ...OLD_GOOGLE_TAG, vtp_tagId: "GT-T9CQH2XR" };
// A GA4 Event tag sends to a destination and loads no script.
const GA4_EVENT_TAG = {
  function: "__gaawe",
  metadata: ["map"],
  vtp_eventName: "tool_run",
  vtp_measurementIdOverride: "G-6N5GK54MWY",
  tag_id: 4,
};
// A Custom HTML tag like the site's Ahrefs one, with a brace and escaped
// quotes inside its string.
const HTML_TAG = {
  function: "__html",
  vtp_html:
    '<script>var s=document.createElement("script");s.src="https://analytics.ahrefs.com/analytics.js";{}</script>',
  tag_id: 5,
};
// A Custom HTML tag that loads gtag/js itself, plus one URL built at run time,
// which can't be read.
const GTAG_HTML_TAG = {
  function: "__html",
  vtp_html:
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-HTMLONLY&l=dataLayer"></script>' +
    '<script>load("https://www.googletagmanager.com/gtag/js?id=" + id);</script>',
  tag_id: 6,
};

// A gtm.js with this resource, and a quoted id in the runtime after it.
function gtmScript(resource) {
  const json = JSON.stringify({ version: "9", macros: [], predicates: [], rules: [], ...resource });
  return `// Copyright 2012 Google Inc.\n(function(){\nvar data = {\n"resource": ${json}\n,"runtime":[[50,"__x",[46,"AW-1234567890"]]]};\n})();`;
}

// A fetch that answers each URL from `answers`: a status, [status, body], or
// an Error to throw. Any other URL is an error, so an unexpected request fails
// the test. It records each request.
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

const container = (resource) => ({ [containerUrl("GTM-TEST")]: [200, gtmScript(resource)] });

test("reads the container's resource object from gtm.js, or null", () => {
  const resource = containerResource(gtmScript({ tags: [NEW_GOOGLE_TAG, HTML_TAG] }));
  assert.deepEqual(resource.tags, [NEW_GOOGLE_TAG, HTML_TAG]);
  assert.equal(containerResource("(function(){ var data = {}; })()"), null);
  assert.equal(containerResource('var data = {"resource": {"tags": [notJson]}}'), null);
  assert.equal(containerResource('var data = {"resource": {"tags": ['), null);
});

test("finds the ids Google tags load, typed in or from a Constant, and Custom HTML gtag snippets", () => {
  const macros = [
    { function: "__e" },
    { function: "__c", vtp_value: "G-CONSTANT1" },
    { function: "__smm", vtp_input: ["macro", 2], vtp_map: ["list"] },
  ];
  const tags = [
    NEW_GOOGLE_TAG,
    { ...NEW_GOOGLE_TAG, vtp_tagId: "AW-951049332" },
    { ...NEW_GOOGLE_TAG, vtp_tagId: "DC-6266241" },
    { ...NEW_GOOGLE_TAG, vtp_tagId: ["macro", 1] },
    { ...NEW_GOOGLE_TAG, tag_id: 9 },
    GA4_EVENT_TAG,
    HTML_TAG,
    GTAG_HTML_TAG,
    { ...GTAG_HTML_TAG, vtp_html: GTAG_HTML_TAG.vtp_html.replace("G-HTMLONLY", "GT-T9CQH2XR") },
  ];
  assert.deepEqual(googleTags({ macros, tags }), {
    ids: ["GT-T9CQH2XR", "AW-951049332", "DC-6266241", "G-CONSTANT1", "G-HTMLONLY"],
    unresolved: 0,
  });
  // A lookup table, a missing variable and a missing Tag ID can't be read.
  const unreadable = [["macro", 2], ["macro", 7], undefined].map((tagId) => ({
    ...NEW_GOOGLE_TAG,
    vtp_tagId: tagId,
  }));
  assert.deepEqual(googleTags({ macros, tags: unreadable }), { ids: [], unresolved: 3 });
  assert.deepEqual(googleTags({}), { ids: [], unresolved: 0 });
});

test("passes when every Google tag answers 200, asking Google with the given headers", async () => {
  const { fetch, requests } = stubFetch({
    ...container({ tags: [NEW_GOOGLE_TAG] }),
    [googleTagUrl("GT-T9CQH2XR")]: 200,
  });
  const result = await checkGoogleTags("GTM-TEST", {
    fetch,
    timeoutMs: 5000,
    headers: { "user-agent": "smoke" },
  });
  assert.equal(result.state, "passed");
  assert.equal(result.message, "GTM-TEST loads GT-T9CQH2XR, and each gtag/js answers 200");
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

test("a GA4 Event tag for a G- id whose gtag/js answers 404 doesn't fail the check", async () => {
  // The site's own setup: GA4 records G-6N5GK54MWY through GT-T9CQH2XR.
  const { fetch, requests } = stubFetch({
    ...container({ tags: [NEW_GOOGLE_TAG, GA4_EVENT_TAG, HTML_TAG] }),
    [googleTagUrl("GT-T9CQH2XR")]: 200,
    [googleTagUrl("G-6N5GK54MWY")]: 404,
  });
  const result = await checkGoogleTags("GTM-TEST", { fetch });
  assert.equal(result.state, "passed");
  assert.deepEqual(result.tags, { "GT-T9CQH2XR": 200 });
  assert.equal(requests.length, 2);
});

test("fails naming each Google tag that doesn't answer 200", async () => {
  const { fetch } = stubFetch({
    ...container({ tags: [OLD_GOOGLE_TAG, NEW_GOOGLE_TAG] }),
    [googleTagUrl("G-6N5GK54MWY")]: 404,
    [googleTagUrl("GT-T9CQH2XR")]: 200,
  });
  const result = await checkGoogleTags("GTM-TEST", { fetch });
  assert.equal(result.state, "failed");
  assert.equal(
    result.message,
    "GTM-TEST loads Google tags whose gtag/js doesn't answer 200: G-6N5GK54MWY (answered 404)",
  );
  assert.deepEqual(result.tags, { "G-6N5GK54MWY": 404, "GT-T9CQH2XR": 200 });
});

test("checks a Custom HTML gtag snippet by the same rules", async () => {
  const { fetch } = stubFetch({
    ...container({ tags: [NEW_GOOGLE_TAG, GTAG_HTML_TAG] }),
    [googleTagUrl("GT-T9CQH2XR")]: 200,
    [googleTagUrl("G-HTMLONLY")]: 404,
  });
  const result = await checkGoogleTags("GTM-TEST", { fetch });
  assert.equal(result.state, "failed");
  assert.match(result.message, /: G-HTMLONLY \(answered 404\)$/);

  const alone = stubFetch({
    ...container({ tags: [GTAG_HTML_TAG] }),
    [googleTagUrl("G-HTMLONLY")]: 503,
  });
  const unreached = await checkGoogleTags("GTM-TEST", { fetch: alone.fetch });
  assert.deepEqual(
    [unreached.state, unreached.message],
    ["warning", "GTM-TEST: couldn't check G-HTMLONLY (answered 503)"],
  );
});

test("fails when gtm.js answers anything but 200 or unavailable", async () => {
  for (const status of [403, 404]) {
    const { fetch } = stubFetch({ [containerUrl("GTM-TEST")]: [status, "Not found"] });
    const result = await checkGoogleTags("GTM-TEST", { fetch });
    assert.equal(result.state, "failed");
    assert.equal(result.message, `GTM-TEST's gtm.js answered ${status}`);
  }
});

test("warns, not fails, when Google can't be reached, times out, rate-limits or answers 5xx", async () => {
  for (const answer of [new TypeError("fetch failed"), 408, 429, 503]) {
    const { fetch } = stubFetch({ [containerUrl("GTM-TEST")]: answer });
    const result = await checkGoogleTags("GTM-TEST", { fetch });
    assert.equal(result.state, "warning", String(answer));
    assert.match(
      result.message,
      /couldn't read GTM-TEST's gtm.js .*so its Google tags weren't checked/,
    );
  }

  const tagsDown = { "G-A": 503, "G-B": 429, "G-C": 408, "G-D": new TypeError("fetch failed") };
  const { fetch } = stubFetch({
    ...container({
      tags: Object.keys(tagsDown).map((id) => ({ ...NEW_GOOGLE_TAG, vtp_tagId: id })),
    }),
    ...Object.fromEntries(
      Object.entries(tagsDown).map(([id, answer]) => [googleTagUrl(id), answer]),
    ),
  });
  const result = await checkGoogleTags("GTM-TEST", { fetch });
  assert.equal(result.state, "warning");
  assert.equal(
    result.message,
    "GTM-TEST: couldn't check G-A (answered 503), G-B (answered 429), G-C (answered 408), G-D (fetch failed)",
  );
});

test("a tag that answers 404 fails even when another can't be reached", async () => {
  const { fetch } = stubFetch({
    ...container({ tags: [OLD_GOOGLE_TAG, NEW_GOOGLE_TAG] }),
    [googleTagUrl("G-6N5GK54MWY")]: 404,
    [googleTagUrl("GT-T9CQH2XR")]: new TypeError("fetch failed"),
  });
  const result = await checkGoogleTags("GTM-TEST", { fetch });
  assert.equal(result.state, "failed");
  assert.match(result.message, /G-6N5GK54MWY \(answered 404\)$/);
});

test("warns when it can't tell which Google tags the container loads", async () => {
  const cases = [
    [
      { [containerUrl("GTM-TEST")]: [200, "/* no resource */"] },
      "couldn't find the tags in GTM-TEST's gtm.js, so its Google tags weren't checked",
    ],
    [container({ tags: [GA4_EVENT_TAG, HTML_TAG] }), "GTM-TEST loads no Google tag"],
    [
      {
        ...container({ tags: [NEW_GOOGLE_TAG, { ...NEW_GOOGLE_TAG, vtp_tagId: ["macro", 0] }] }),
        [googleTagUrl("GT-T9CQH2XR")]: 200,
      },
      "GTM-TEST: 1 Google tag(s) take their Tag ID from a variable this check can't read",
    ],
  ];
  for (const [answers, message] of cases) {
    const result = await checkGoogleTags("GTM-TEST", { fetch: stubFetch(answers).fetch });
    assert.deepEqual([result.state, result.message], ["warning", message]);
  }
});

test("the report exits 1 only on a failure, and annotates failures and warnings in GitHub Actions", () => {
  const failed = {
    state: "failed",
    message: "GTM-TEST loads …: G-6N5GK54MWY (answered 404)",
    tags: { "G-6N5GK54MWY": 404 },
  };
  assert.deepEqual(outcomeReport(failed, { githubActions: true }), {
    lines: [
      `::error::Google tags failed: GTM-TEST loads …: G-6N5GK54MWY (answered 404). ${FAILURE_HINT}`,
      "  https://www.googletagmanager.com/gtag/js?id=G-6N5GK54MWY: 404",
    ],
    exitCode: 1,
  });
  // The run page says the release is fine and where to fix the tag.
  assert.match(FAILURE_HINT, /Tag Manager.*don't roll it back.*audit:google-tags.*re-run/);
  const warning = { state: "warning", message: "GTM-TEST loads no Google tag", tags: {} };
  assert.deepEqual(outcomeReport(warning, { githubActions: true }), {
    lines: ["::warning::Google tags warning: GTM-TEST loads no Google tag."],
    exitCode: 0,
  });
  assert.deepEqual(outcomeReport(warning).lines, [
    "Google tags warning: GTM-TEST loads no Google tag.",
  ]);
  const passed = {
    state: "passed",
    message: "GTM-TEST loads GT-T9CQH2XR",
    tags: { "GT-T9CQH2XR": 200 },
  };
  assert.equal(
    outcomeReport(passed, { githubActions: true }).lines[0],
    "Google tags passed: GTM-TEST loads GT-T9CQH2XR.",
  );
  assert.equal(outcomeReport(passed).exitCode, 0);
});

import test from "node:test";
import assert from "node:assert/strict";

import { scrubEvent, sentryRelease, SENTRY_DEFAULTS } from "./sentry-scrub.ts";

test("error reports keep the error and page path, never user data", () => {
  const event = scrubEvent({
    exception: { values: [{ type: "Error", value: "convert_failed" }] },
    user: { ip_address: "203.0.113.9", id: "device-1" },
    extra: { file: "secret-plan.pdf" },
    request: {
      url: "https://tools.serp.co/png-to-jpg/?token=abc#frag",
      method: "POST",
      headers: { cookie: "session=1", "user-agent": "x" },
      cookies: { session: "1" },
      data: "file bytes",
      query_string: "token=abc",
    },
    contexts: { culture: { locale: "en" }, cloud_resource: { region: "x" }, runtime: { name: "workerd" } },
    breadcrumbs: [
      { category: "console", message: "Conversion failed for secret-plan.pdf" },
      { category: "fetch", data: { url: "/api/telemetry?x=1", method: "POST", status_code: 200, body: "x" } },
      { category: "ui.click", message: "button.convert", data: { target: "x" } },
    ],
  });

  assert.deepEqual(event.exception.values[0], { type: "Error", value: "convert_failed" });
  assert.equal(event.user, undefined);
  assert.equal(event.extra, undefined);
  assert.deepEqual(event.request, { url: "https://tools.serp.co/png-to-jpg/", method: "POST" });
  assert.deepEqual(Object.keys(event.contexts), ["runtime"]);
  assert.deepEqual(event.breadcrumbs, [
    { category: "fetch", data: { url: "/api/telemetry", method: "POST", status_code: 200 } },
    { category: "ui.click", message: "button.convert", data: undefined },
  ]);
  assert.equal(JSON.stringify(event).includes("secret-plan"), false);
  assert.equal(JSON.stringify(event).includes("203.0.113.9"), false);
});

test("the release is the deployed commit, shared by browser and Worker", () => {
  assert.equal(sentryRelease("5a8de42460e1"), "tools-serp-co@5a8de42460e1");
  assert.equal(sentryRelease("unknown"), undefined);
  assert.equal(sentryRelease(undefined), undefined);
});

test("no default PII, tracing or replay", () => {
  assert.equal(SENTRY_DEFAULTS.sendDefaultPii, false);
  assert.equal(SENTRY_DEFAULTS.tracesSampleRate, 0);
});

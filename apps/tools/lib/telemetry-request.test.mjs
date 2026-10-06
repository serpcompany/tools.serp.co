import test from "node:test";
import assert from "node:assert/strict";

import { attachRequestMetadata, sentGlobalPrivacyControl } from "./telemetry-request.ts";

function request(headers = {}) {
  return new Request("https://tools.serp.co/api/telemetry", { method: "POST", headers });
}

test("the server adds ip, user agent and release", () => {
  const payload = attachRequestMetadata(
    { event: "tool_run_started", metadata: { engine: "worker" } },
    request({ "cf-connecting-ip": "203.0.113.7", "user-agent": "UA/1" }),
    "abc123",
  );
  assert.deepEqual(payload.metadata, {
    release: "abc123",
    ip: "203.0.113.7",
    userAgent: "UA/1",
    engine: "worker",
  });
});

test("a client can't set ip, user agent or release, even without a server value", () => {
  const spoofed = { ip: "198.51.100.1", userAgent: "fake", release: "spoofed", engine: "worker" };
  const withRelease = attachRequestMetadata(
    { metadata: spoofed },
    request({ "cf-connecting-ip": "203.0.113.7", "user-agent": "UA/1" }),
    "abc123",
  );
  assert.deepEqual(withRelease.metadata, {
    release: "abc123",
    ip: "203.0.113.7",
    userAgent: "UA/1",
    engine: "worker",
  });

  // "" rather than undefined: undefined falls back to NEXT_PUBLIC_RELEASE.
  const withoutServerValues = attachRequestMetadata({ metadata: spoofed }, request(), "");
  assert.deepEqual(withoutServerValues.metadata, { engine: "worker" });

  const onlyServerKeys = attachRequestMetadata(
    { metadata: { ip: "198.51.100.1", release: "spoofed" } },
    request(),
    "",
  );
  assert.deepEqual(onlyServerKeys.metadata, {});
});

test("cf-connecting-ip wins over a client-controlled x-forwarded-for", () => {
  const payload = attachRequestMetadata(
    { metadata: {} },
    request({ "x-forwarded-for": "198.51.100.1, 10.0.0.1", "cf-connecting-ip": "203.0.113.7" }),
    "",
  );
  assert.equal(payload.metadata.ip, "203.0.113.7");
});

test("non-object payloads pass through for the validator to reject", () => {
  assert.equal(attachRequestMetadata(null, request(), "abc123"), null);
  assert.deepEqual(attachRequestMetadata([1], request(), "abc123"), [1]);
});

test("a request with Sec-GPC: 1 is recognized as opted out", () => {
  assert.equal(sentGlobalPrivacyControl(request({ "sec-gpc": "1" })), true);
  assert.equal(sentGlobalPrivacyControl(request({ "sec-gpc": "0" })), false);
  assert.equal(sentGlobalPrivacyControl(request()), false);
});

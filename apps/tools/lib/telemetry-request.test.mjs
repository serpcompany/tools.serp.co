import test from "node:test";
import assert from "node:assert/strict";

import { attachRequestMetadata } from "./telemetry-request.ts";

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

  const withoutServerValues = attachRequestMetadata({ metadata: spoofed }, request(), undefined);
  assert.deepEqual(withoutServerValues.metadata, { engine: "worker" });
});

test("cf-connecting-ip wins over a client-controlled x-forwarded-for", () => {
  const payload = attachRequestMetadata(
    { metadata: {} },
    request({ "x-forwarded-for": "198.51.100.1, 10.0.0.1", "cf-connecting-ip": "203.0.113.7" }),
    undefined,
  );
  assert.equal(payload.metadata.ip, "203.0.113.7");
});

test("non-object payloads pass through for the validator to reject", () => {
  assert.equal(attachRequestMetadata(null, request(), "abc123"), null);
  assert.deepEqual(attachRequestMetadata([1], request(), "abc123"), [1]);
});

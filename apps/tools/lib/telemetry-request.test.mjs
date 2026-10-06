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

test("a client can't set the release", () => {
  const payload = attachRequestMetadata(
    { metadata: { release: "spoofed" } },
    request(),
    "abc123",
  );
  assert.equal(payload.metadata.release, "abc123");
  assert.equal(Object.keys(payload.metadata)[0], "release");
});

test("a client-sent ip or user agent still wins, as before", () => {
  const payload = attachRequestMetadata(
    { metadata: { ip: "198.51.100.1" } },
    request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
    undefined,
  );
  assert.equal(payload.metadata.ip, "198.51.100.1");
});

test("non-object payloads pass through for the validator to reject", () => {
  assert.equal(attachRequestMetadata(null, request(), "abc123"), null);
  assert.deepEqual(attachRequestMetadata([1], request(), "abc123"), [1]);
});

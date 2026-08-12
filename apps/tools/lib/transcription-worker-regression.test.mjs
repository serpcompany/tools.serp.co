import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/transcription-worker-d3e6c4c.json", import.meta.url),
    "utf8",
  ),
);
const canarySource = readFileSync(
  new URL("../scripts/canary-cloudflare-deployed.mjs", import.meta.url),
  "utf8",
);

test("the pinned preview baseline retains the isolated Worker header failure", () => {
  assert.equal(
    fixture.baselineRevision,
    "d3e6c4c44af0d0a6a8e243f4a4e61963bb838e87",
  );
  assert.equal(fixture.route, "/audio-to-text/");
  assert.match(fixture.workerChunkPath, /^\/_next\/static\/chunks\/[a-f0-9.-]+\.js$/);
  assert.match(fixture.chunkSha256, /^[a-f0-9]{64}$/);
  assert.ok(
    fixture.chunkSha256.startsWith(
      fixture.workerChunkPath.match(/\.([a-f0-9]{16})\.js$/)[1],
    ),
  );
  assert.equal(fixture.pageHeaders.crossOriginEmbedderPolicy, "require-corp");
  assert.equal(fixture.chunkResponse.status, 200);
  assert.equal(fixture.chunkResponse.crossOriginEmbedderPolicy, null);
  assert.equal(fixture.chunkResponse.crossOriginResourcePolicy, null);
  assert.equal(fixture.browserObservation.workerRequestStatus, 0);
  assert.equal(
    fixture.browserObservation.networkError,
    "ERR_BLOCKED_BY_RESPONSE",
  );
  assert.equal(fixture.browserObservation.ordinaryFetchStatus, 200);
});

test("the deployed canary requires isolation headers on the exact emitted Worker chunk", () => {
  assert.match(canarySource, /Xenova\/whisper-tiny/);
  assert.match(canarySource, /cross-origin-embedder-policy/);
  assert.match(canarySource, /credentialless/);
  assert.match(canarySource, /cross-origin-resource-policy/);
  assert.match(canarySource, /same-origin/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMediaWorkflowTestHarness } from "./testing.ts";

const SAMPLE_MP4_BYTES = new Uint8Array(
  readFileSync(
    new URL("../../benchmarks/fixtures/sample.mp4", import.meta.url),
  ),
);

test("semantic-invalid transcription output commits exactly one failed terminal", async () => {
  const harness = createMediaWorkflowTestHarness({ transcript: "   " });

  const outcome = await harness.workflow.run({
    toolId: "mp4-to-transcript",
    input: {
      kind: "file",
      media: {
        name: "voice.mp4",
        format: "mp4",
        mimeType: "video/mp4",
        bytes: SAMPLE_MP4_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "invalid-result");
  assert.deepEqual(harness.deliveries, []);
  assert.deepEqual(harness.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "failed" },
  ]);
  assert.equal(
    harness.telemetry.filter(({ kind }) => kind === "terminal").length,
    1,
  );
});

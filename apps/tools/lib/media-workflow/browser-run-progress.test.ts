import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserRunOwnership } from "./browser-run-ownership.ts";
import { createBrowserRunProgress } from "./browser-run-progress.ts";

test("browser run progress owns lease guards and monotonic transfer/snapshot projection", () => {
  const ownership = createBrowserRunOwnership();
  const lease = ownership.begin();
  const progress = createBrowserRunProgress({
    lease,
    name: "Remote media",
    messages: {
      acquiring: "Downloading...",
      processing: "Transcribing...",
      validating: "Transcribing...",
      delivering: "Preparing transcript...",
    },
  });

  assert.deepEqual(
    progress.fromTransfer({
      receivedBytes: 5,
      totalBytes: 10,
      ratio: 0.5,
      bytesPerSecond: 5,
      etaSeconds: 1,
    }),
    {
      name: "Remote media",
      progress: 50,
      status: "loading",
      message: "5 B of 10 B • 5 B/s • 1s remaining",
    },
  );
  assert.deepEqual(progress.fromSnapshot({ phase: "acquiring", progress: 0.1 }), {
    name: "Remote media",
    progress: 50,
    status: "loading",
    message: "Downloading...",
  });
  assert.deepEqual(progress.fromSnapshot({ phase: "delivering", progress: 0.9 }), {
    name: "Remote media",
    progress: 90,
    status: "processing",
    message: "Preparing transcript...",
  });
  assert.deepEqual(progress.fromError("Transcription failed"), {
    name: "Remote media",
    progress: 90,
    status: "error",
    message: "Transcription failed",
  });
  assert.equal(progress.fromSnapshot({ phase: "succeeded" }), undefined);

  ownership.abort("view unmounted");
  assert.equal(
    progress.fromTransfer({ receivedBytes: 8, bytesPerSecond: 1 }),
    undefined,
  );
  assert.equal(
    progress.fromSnapshot({ phase: "processing", progress: 1 }),
    undefined,
  );
  assert.equal(progress.fromError("late failure"), undefined);
});

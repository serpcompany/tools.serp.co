import assert from "node:assert/strict";
import test from "node:test";

import { withSilenceWatchdog } from "./silence-watchdog.ts";

test("a silent browser worker operation reaches one bounded failure", async () => {
  await assert.rejects(
    withSilenceWatchdog({
      run: async () => await new Promise<never>(() => {}),
      signal: new AbortController().signal,
      timeoutMs: 10,
      timeoutMessage: "Transcription worker stopped responding",
    }),
    /Transcription worker stopped responding/,
  );
});

test("progress extends the silence deadline", async () => {
  const result = await withSilenceWatchdog({
    async run(pulse) {
      await new Promise((resolve) => setTimeout(resolve, 8));
      pulse();
      await new Promise((resolve) => setTimeout(resolve, 8));
      return "terminal";
    },
    signal: new AbortController().signal,
    timeoutMs: 12,
    timeoutMessage: "timed out",
  });
  assert.equal(result, "terminal");
});

test("cancellation wins over a late operation outcome", async () => {
  const controller = new AbortController();
  const pending = withSilenceWatchdog({
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "late";
    },
    signal: controller.signal,
    timeoutMs: 1_000,
    timeoutMessage: "timed out",
  });
  controller.abort("replaced");
  await assert.rejects(pending, /Transcription cancelled/);
});

test("late progress after timeout cannot arm another timer", async () => {
  let latePulse: (() => void) | undefined;
  await assert.rejects(
    withSilenceWatchdog({
      run: async (pulse) => {
        latePulse = pulse;
        return await new Promise<never>(() => {});
      },
      signal: new AbortController().signal,
      timeoutMs: 5,
      timeoutMessage: "timed out",
    }),
    /timed out/,
  );
  latePulse?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
});

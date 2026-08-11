import assert from "node:assert/strict";
import test from "node:test";

import { readTranscriptionTerminalState } from "./transcription-browser-state.mjs";

function withDocument(elements, callback) {
  const previous = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      return elements[selector] ?? null;
    },
  };
  try {
    return callback();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test("transcription browser state terminates on transcript success or visible workflow error", () => {
  assert.deepEqual(
    withDocument(
      { textarea: { value: "  Clear transcript.  " } },
      readTranscriptionTerminalState,
    ),
    { status: "succeeded", transcript: "Clear transcript." },
  );
  assert.deepEqual(
    withDocument(
      {
        '[data-testid="video-progress"]': {
          getAttribute: () => "error",
          textContent: "sample.mp3 txt result is empty",
        },
      },
      readTranscriptionTerminalState,
    ),
    { status: "failed", message: "sample.mp3 txt result is empty" },
  );
  assert.equal(
    withDocument(
      {
        '[data-testid="video-progress"]': {
          getAttribute: () => "processing",
          textContent: "Transcribing... 63%",
        },
      },
      readTranscriptionTerminalState,
    ),
    null,
  );
});

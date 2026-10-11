import test from "node:test";
import assert from "node:assert/strict";

import { convertWithWorker } from "./workerClient.ts";

// Node has no canvas: a stand-in that measures text at 7 px a character,
// draws nothing, and encodes to a few bytes with the format's signature, so
// the CSV to image path runs as far as the notice it returns.
const SIGNATURES = { "image/jpeg": [0xff, 0xd8, 0xff, 0xe0], "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] };
class FakeCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    const measureText = (text) => ({ width: text.length * 7 });
    return new Proxy({}, { get: (target, key) => (key === "measureText" ? measureText : key in target ? target[key] : () => {}) });
  }
  async convertToBlob({ type }) {
    return new Blob([new Uint8Array([...SIGNATURES[type], 0, 0, 0, 0])], { type });
  }
}

async function csvToJpg(csv) {
  const previous = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeCanvas;
  try {
    const buf = new TextEncoder().encode(csv).buffer;
    return await convertWithWorker({ worker: undefined, from: "csv", to: "jpg", buf });
  } finally {
    globalThis.OffscreenCanvas = previous;
  }
}

test("CSV to JPG says when the image holds only the first rows, as the table pages do", async () => {
  const rows = Array.from({ length: 1_000 }, (_, index) => `row ${index + 1},${index}`);
  const result = await csvToJpg(`name,count\n${rows.join("\n")}\n`);
  assert.equal(result.kind, "single");
  assert.match(
    result.notice,
    /^Showing the first \d+ of 1,000 rows\. The image holds what fits in 4096 pixels; save as PDF or Excel for the whole table\.$/,
  );
});

test("CSV to JPG has no notice when the whole table fits, and reads a one-column CSV", async () => {
  const whole = await csvToJpg("name,count\nAlpha,1\nBeta,2\n");
  assert.equal(whole.kind, "single");
  assert.equal(whole.notice, undefined);
  const oneColumn = await csvToJpg("name\nAlpha\nBeta\n");
  assert.equal(oneColumn.kind, "single");
  assert.deepEqual([...new Uint8Array(oneColumn.buffer).subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

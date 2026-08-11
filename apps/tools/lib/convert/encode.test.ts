import assert from "node:assert/strict";
import test from "node:test";

import { encodeFromRGBA } from "./encode.ts";

test("main-thread image encoding aborts promptly while canvas encoding is stalled", async () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const originalImageData = globalThis.ImageData;
  globalThis.ImageData = class {
    constructor() {}
  } as never;
  globalThis.OffscreenCanvas = class {
    getContext() {
      return { putImageData() {} };
    }
    convertToBlob() {
      return new Promise<Blob>(() => {});
    }
  } as never;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const started = performance.now();
  try {
    await assert.rejects(
      encodeFromRGBA(
        "jpg",
        { data: new Uint8ClampedArray(4), width: 1, height: 1 },
        0.82,
        controller.signal,
      ),
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError",
    );
  } finally {
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
    globalThis.ImageData = originalImageData;
  }
  assert.ok(performance.now() - started < 150);
});

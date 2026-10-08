import test from "node:test";
import assert from "node:assert/strict";

import { MAX_RENDER_PIXELS, pageRenderScale } from "./pdf.ts";

test("pages render at twice their size", () => {
  assert.equal(pageRenderScale(612, 792), 2); // US Letter
  assert.equal(pageRenderScale(96, 96), 2);
});

test("a large page renders at no more pixels than every browser's canvas allows", () => {
  for (const [width, height] of [[6912, 6912], [2384, 3370], [16000, 400]]) {
    const scale = pageRenderScale(width, height);
    assert.ok(scale < 2, `${width}x${height}`);
    assert.ok(
      Math.ceil(width * scale) * Math.ceil(height * scale) <= MAX_RENDER_PIXELS,
      `${width}x${height} at ${scale}`,
    );
  }
  assert.equal(MAX_RENDER_PIXELS, 4096 * 4096);
});

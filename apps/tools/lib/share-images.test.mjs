import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";

import { SHARE_IMAGES, SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from "./share-images.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Social sites fetch the image with every share; keep each one small.
const MAX_BYTES = 150_000;

test("every share image is a 1200x630 PNG under public/, as metadata declares", () => {
  for (const [name, image] of Object.entries(SHARE_IMAGES)) {
    assert.match(image.path, /^\/og\/[a-z-]+\.png$/, name);
    const file = new URL(`../public${image.path}`, import.meta.url);
    assert.ok(existsSync(file), `${image.path} is missing: run pnpm -C apps/tools share-images`);
    const png = readFileSync(file);
    assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), `${image.path} isn't a PNG`);
    // The IHDR chunk follows the signature: length, type, then width and height.
    assert.equal(png.toString("ascii", 12, 16), "IHDR", image.path);
    assert.equal(png.readUInt32BE(16), SHARE_IMAGE_WIDTH, `${image.path} width`);
    assert.equal(png.readUInt32BE(20), SHARE_IMAGE_HEIGHT, `${image.path} height`);
    assert.ok(png.length <= MAX_BYTES, `${image.path} is ${png.length} B`);
  }
});

test("the share images are served from this site, not a third-party origin", () => {
  for (const image of Object.values(SHARE_IMAGES)) {
    assert.ok(image.path.startsWith("/"), image.path);
    assert.doesNotMatch(image.path, /^\/\//, image.path);
  }
});

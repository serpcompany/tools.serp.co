import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { deflateSync } from "node:zlib";

// The real ImageMagick WASM build, served to magickBrowser.ts's fetch from
// disk. This file runs in its own process, so WASM memory starts at its
// initial size, as on a page that hasn't converted anything yet.
const require = createRequire(import.meta.url);
const wasm = readFileSync(
  path.join(path.dirname(require.resolve("@imagemagick/magick-wasm")), "magick.wasm"),
);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(wasm);
test.after(() => {
  globalThis.fetch = originalFetch;
});
const { convertWithMagickInBrowser } = await import("./magickBrowser.ts");
const magick = await import("@imagemagick/magick-wasm");

// An OpenEXR file of one grey (`half`, the bits of a 16-bit float) in B, G
// and R, ZIP-compressed in blocks of 16 rows, as renderers write it. Made
// here rather than by ImageMagick, which would grow WASM memory as it built
// the image, before the conversion under test.
function greyExr(width, height, half) {
  const ascii = (text) => [...new TextEncoder().encode(text), 0];
  const int32 = (value) => [...new Uint8Array(Int32Array.of(value).buffer)];
  const float32 = (value) => [...new Uint8Array(Float32Array.of(value).buffer)];
  const attribute = (name, type, value) => [...ascii(name), ...ascii(type), ...int32(value.length), ...value];
  // Each channel: name, HALF, not linear, reserved, x and y sampling 1.
  const channels = [...["B", "G", "R"].flatMap((name) => [...ascii(name), ...int32(1), 0, 0, 0, 0, ...int32(1), ...int32(1)]), 0];
  const box = [...int32(0), ...int32(0), ...int32(width - 1), ...int32(height - 1)];
  const header = [
    0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0,
    ...attribute("channels", "chlist", channels),
    ...attribute("compression", "compression", [3]), // ZIP, 16 rows a block
    ...attribute("dataWindow", "box2i", box),
    ...attribute("displayWindow", "box2i", box),
    ...attribute("lineOrder", "lineOrder", [0]),
    ...attribute("pixelAspectRatio", "float", float32(1)),
    ...attribute("screenWindowCenter", "v2f", [...float32(0), ...float32(0)]),
    ...attribute("screenWindowWidth", "float", float32(1)),
    0,
  ];
  const blocks = [];
  for (let top = 0; top < height; top += 16) {
    const rows = Math.min(16, height - top);
    const raw = new Uint8Array(rows * 3 * width * 2);
    for (let index = 0; index < raw.length; index += 2) {
      raw[index] = half & 0xff;
      raw[index + 1] = half >> 8;
    }
    // ZIP's filter: even bytes, then odd bytes, then each as the difference
    // from the one before (+128).
    const split = new Uint8Array(raw.length);
    const half1 = (raw.length + 1) >> 1;
    for (let index = 0; index < raw.length; index += 1) {
      split[(index & 1 ? half1 : 0) + (index >> 1)] = raw[index];
    }
    for (let index = split.length - 1; index > 0; index -= 1) {
      split[index] = (split[index] - split[index - 1] + 128) & 0xff;
    }
    const data = deflateSync(split);
    blocks.push(Uint8Array.from([...int32(top), ...int32(data.length), ...data]));
  }
  const offsets = new BigUint64Array(blocks.length);
  let offset = header.length + blocks.length * 8;
  blocks.forEach((block, index) => {
    offsets[index] = BigInt(offset);
    offset += block.length;
  });
  const file = new Uint8Array(offset);
  file.set(header);
  file.set(new Uint8Array(offsets.buffer), header.length);
  let at = header.length + blocks.length * 8;
  for (const block of blocks) {
    file.set(block, at);
    at += block.length;
  }
  return file.buffer;
}

// Encoding EXR to sRGB used to write a view into WASM memory back through
// setArea, which allocates as much as the image and so grows memory for a
// large one, detaching the view: 1920 x 1080 and larger failed with "Cannot
// perform %TypedArray%.prototype.set on a detached ArrayBuffer".
test("a 1920 x 1080 and a 3840 x 2160 EXR convert", async () => {
  for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
    // 0x3400 is 0.25, which is 137 in sRGB.
    const { buffer } = await convertWithMagickInBrowser(greyExr(width, height, 0x3400), "exr", "png");
    const png = magick.ImageMagick.read(new Uint8Array(buffer), magick.MagickFormat.Png, (image) => ({
      width: image.width,
      height: image.height,
      corners: [[0, 0], [width - 1, height - 1]].map(([x, y]) =>
        image.getPixels((pixels) => [...pixels.toByteArray(x, y, 1, 1, "RGB")]),
      ),
    }));
    assert.deepEqual(png, { width, height, corners: [[137, 137, 137], [137, 137, 137]] }, `${width} x ${height}`);
  }
});

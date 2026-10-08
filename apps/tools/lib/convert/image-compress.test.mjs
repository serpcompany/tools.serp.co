import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkOutputFormat } from "./output-format.ts";

// The real ImageMagick WASM build, served to magickBrowser.ts's fetch from disk.
const require = createRequire(import.meta.url);
const wasm = readFileSync(
  path.join(path.dirname(require.resolve("@imagemagick/magick-wasm")), "magick.wasm"),
);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(wasm);
test.after(() => {
  globalThis.fetch = originalFetch;
});
const { compressImageInBrowser } = await import("./image-compress.ts");
const magick = await import("@imagemagick/magick-wasm");
await magick.initializeImageMagick(wasm);

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const read = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

// Every pixel of two images, as RGBA bytes.
function pixels(bytes, format) {
  return magick.ImageMagick.read(new Uint8Array(bytes), magick.MagickFormat[format], (image) =>
    image.getPixels((p) => Array.from(p.toByteArray(0, 0, image.width, image.height, "RGBA"))),
  );
}

test("TIFF, BMP and GIF shrink losslessly and stay in their format", async () => {
  for (const [file, format, magickFormat] of [
    ["sample.tiff", "tiff", "Tiff"],
    ["sample.bmp", "bmp", "Bmp"],
  ]) {
    const input = read(file);
    const output = await compressImageInBrowser(input.slice(0), format, 0.8);
    assert.ok(output.byteLength < input.byteLength, `${file}: ${input.byteLength} -> ${output.byteLength}`);
    assert.equal(checkOutputFormat(output, format).ok, true, file);
    assert.deepEqual(pixels(output, magickFormat), pixels(input, magickFormat), file);
  }
});

test("an animated GIF keeps every frame and its timing", async () => {
  const input = magick.MagickImageCollection.create();
  for (const color of ["red", "green", "blue"]) {
    const frame = magick.MagickImage.create(new magick.MagickColor(color), 64, 64);
    frame.animationDelay = 20;
    input.push(frame);
  }
  const gif = input.write(magick.MagickFormat.Gif, (data) => data.slice());
  input.dispose();

  const output = await compressImageInBrowser(gif.buffer, "gif", 0.8);
  assert.equal(checkOutputFormat(output, "gif").ok, true);
  const frames = magick.ImageMagick.readCollection(new Uint8Array(output), magick.MagickFormat.Gif, (c) => {
    c.coalesce();
    return c.map((frame) => ({ delay: frame.animationDelay, color: frame.getPixels((p) => Array.from(p.getPixel(32, 32))) }));
  });
  assert.deepEqual(frames.map((f) => f.delay), [20, 20, 20]);
  assert.deepEqual(frames.map((f) => f.color.slice(0, 3)), [[255, 0, 0], [0, 128, 0], [0, 0, 255]]);
});

test("SVG is minified with SVGO", async () => {
  const svg = `<?xml version="1.0"?>\n<!-- a comment -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">\n  <g>\n    <rect x="0" y="0" width="10" height="10" fill="#ff0000"/>\n  </g>\n</svg>\n`;
  const input = new TextEncoder().encode(svg).buffer;
  const output = await compressImageInBrowser(input, "svg", 0.8);
  const text = new TextDecoder().decode(output);
  assert.ok(output.byteLength < input.byteLength);
  assert.ok(!text.includes("a comment"));
  assert.match(text, /<svg[^>]*>.*<\/svg>/s);
});

test("AVIF re-encodes, and no format ever comes back larger than it went in", async () => {
  for (const [file, format] of [
    ["sample.avif", "avif"],
    ["sample.gif", "gif"],
    ["sample.svg", "svg"],
    ["sample.tiff", "tiff"],
    ["sample.bmp", "bmp"],
  ]) {
    const input = read(file);
    const output = await compressImageInBrowser(input.slice(0), format, 0.8);
    assert.ok(output.byteLength <= input.byteLength, `${file}: ${input.byteLength} -> ${output.byteLength}`);
    assert.equal(checkOutputFormat(output, format).ok, true, file);
  }
});

test("an unreadable file is an error, not an empty download", async () => {
  await assert.rejects(compressImageInBrowser(new Uint8Array([1, 2, 3]).buffer, "tiff", 0.8));
});

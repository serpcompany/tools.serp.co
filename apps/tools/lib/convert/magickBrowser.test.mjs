import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkOutputFormat } from "./output-format.ts";

// The real ImageMagick WASM build the site ships, loaded the way the page
// loads it: magickBrowser.ts fetches the wasm, so fetch serves it from disk.
const require = createRequire(import.meta.url);
const wasm = readFileSync(
  path.join(path.dirname(require.resolve("@imagemagick/magick-wasm")), "magick.wasm"),
);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(wasm);
test.after(() => {
  globalThis.fetch = originalFetch;
});
const { convertWithMagickInBrowser, encodePngWithMagick } = await import("./magickBrowser.ts");
// The same module instance magickBrowser.ts initialised, for reading outputs back.
const magick = await import("@imagemagick/magick-wasm");

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const read = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

// ICO and CUR directory entries store width and height in one byte each; 0 means 256.
function iconSize(buffer) {
  const bytes = new Uint8Array(buffer);
  return { width: bytes[6] || 256, height: bytes[7] || 256 };
}

test("camera RAW converts to ICO and CUR at no more than 256 px a side", async () => {
  for (const [file, from, to, size] of [
    ["sample.cr2", "cr2", "ico", { width: 256, height: 192 }],
    ["sample.cr2", "cr2", "cur", { width: 256, height: 192 }],
    ["sample.dng", "dng", "ico", { width: 256, height: 256 }],
  ]) {
    const { buffer, format } = await convertWithMagickInBrowser(read(file), from, to);
    assert.equal(format, to);
    assert.deepEqual(checkOutputFormat(buffer, to), { ok: true }, `${from} to ${to}`);
    assert.deepEqual(iconSize(buffer), size, `${from} to ${to}`);
  }
});

test("a PNG larger than 256 px encodes to ICO, fitted inside 256 px", async () => {
  const { buffer: png } = await convertWithMagickInBrowser(read("sample.dng"), "dng", "png");
  const ico = await encodePngWithMagick(png, "ico");
  const buffer = await ico.arrayBuffer();
  assert.deepEqual(checkOutputFormat(buffer, "ico"), { ok: true });
  assert.deepEqual(iconSize(buffer), { width: 256, height: 256 });
});

test("a small image keeps its size as an icon", async () => {
  const ico = await encodePngWithMagick(read("sample.png"), "ico");
  assert.deepEqual(iconSize(await ico.arrayBuffer()), { width: 96, height: 96 });
});

test("the wasm the site serves is the installed ImageMagick package's", () => {
  const vendored = readFileSync(path.resolve(fixtures, "../../public/vendor/imagemagick/magick.wasm"));
  assert.ok(vendored.equals(wasm), "public/vendor/imagemagick/magick.wasm differs from @imagemagick/magick-wasm");
});

// Mean and standard deviation (0-255) of every channel, as native ImageMagick
// reads the fixture (`magick <file> -format "%[fx:mean*255]
// %[fx:standard_deviation*255]" info:`). Before 0.0.38 (LibRaw 0.22) this
// Nikon lossy NEF decoded as all white and the ORF as coloured noise.
test("camera RAW decodes to the photo native ImageMagick reads", async () => {
  for (const [file, from, native] of [
    ["sample.nef", "nef", { mean: 111.7, sd: 81.2 }],
    ["sample.orf", "orf", { mean: 105.1, sd: 53.8 }],
  ]) {
    const { buffer } = await convertWithMagickInBrowser(read(file), from, "png");
    const { mean, standardDeviation } = magick.ImageMagick.read(new Uint8Array(buffer), magick.MagickFormat.Png, (image) =>
      image.statistics().composite(),
    );
    assert.ok(Math.abs(mean - native.mean) < 2, `${from} mean ${mean.toFixed(1)}, native ${native.mean}`);
    assert.ok(Math.abs(standardDeviation - native.sd) < 2, `${from} sd ${standardDeviation.toFixed(1)}, native ${native.sd}`);
  }
});

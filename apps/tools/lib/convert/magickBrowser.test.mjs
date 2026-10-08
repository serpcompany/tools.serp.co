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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { unzipSync, strFromU8 } from "fflate";

import { imageSize, imageToDocx, textFromImage } from "./image-text.ts";
import { checkOutputFormat } from "./output-format.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const read = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

test("image dimensions come from the PNG or JPEG header", () => {
  assert.deepEqual(imageSize(read("sample-text.png"), "png"), { width: 480, height: 120 });
  assert.deepEqual(imageSize(read("sample-text.jpg"), "jpg"), { width: 480, height: 120 });
  assert.deepEqual(imageSize(read("sample-text.jpg"), "jpeg"), { width: 480, height: 120 });
  assert.throws(() => imageSize(new Uint8Array(8).buffer, "png"), /dimensions/);
});

// 1 inch is 914,400 EMU; a Letter page with 1-inch margins is 6.5 inches wide.
const EMU_PER_INCH = 914400;

test("an image becomes a Word document showing it, fitted to the page width", async () => {
  for (const [file, format, media] of [["sample-text.png", "png", "png"], ["sample-text.jpg", "jpg", "jpg"]]) {
    const input = read(file);
    const docx = await imageToDocx(input, format);
    assert.equal(checkOutputFormat(docx, "docx").ok, true, file);
    const files = unzipSync(new Uint8Array(docx));
    const documentXml = strFromU8(files["word/document.xml"]);
    const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(documentXml);
    assert.ok(extent, `${file}: no drawing`);
    const [width, height] = [Number(extent[1]), Number(extent[2])];
    // 480 px at 96 dpi is 5 inches: it fits, so it keeps its size.
    assert.equal(width, 5 * EMU_PER_INCH, file);
    assert.equal(height, 1.25 * EMU_PER_INCH, file);
    const mediaFile = Object.keys(files).find((name) => name.startsWith("word/media/") && !name.endsWith("/"));
    assert.ok(mediaFile?.endsWith(`.${media}`), `${file}: ${mediaFile}`);
    assert.deepEqual(files[mediaFile], new Uint8Array(input), file);
  }
});

test("a wide image is scaled down to the 6.5-inch text width, keeping its shape", async () => {
  const wide = new Uint8Array(read("sample-text.png"));
  // Rewrite the IHDR width and height to 1920 x 480; the pixels don't matter here.
  new DataView(wide.buffer).setUint32(16, 1920);
  new DataView(wide.buffer).setUint32(20, 480);
  const files = unzipSync(new Uint8Array(await imageToDocx(wide.buffer, "png")));
  const [, cx, cy] = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(strFromU8(files["word/document.xml"]));
  assert.ok(Math.abs(Number(cx) - 6.5 * EMU_PER_INCH) < EMU_PER_INCH / 100, cx);
  assert.ok(Math.abs(Number(cy) / Number(cx) - 0.25) < 0.001, `${cx} x ${cy}`);
});

test("OCR text is trimmed, with Unix line endings and no runs of blank lines", async () => {
  const recognize = async () => "  SERP Tools\r\n\n\n\nOCR  \n";
  const output = await textFromImage(read("sample-text.png"), "png", recognize);
  assert.equal(new TextDecoder().decode(output), "SERP Tools\n\nOCR\n");
});

test("an image with no readable text is an error, not an empty file", async () => {
  await assert.rejects(textFromImage(read("sample-text.png"), "png", async () => " \n "), /No text/);
});

// The site serves its own copies of tesseract.js's worker and core, so they
// must be the installed versions'.
test("the vendored Tesseract worker and core match the installed packages", () => {
  const require = createRequire(import.meta.url);
  const tesseract = path.dirname(require.resolve("tesseract.js/package.json"));
  const core = path.dirname(require.resolve("tesseract.js-core/package.json", { paths: [tesseract] }));
  const vendor = path.resolve(fixtures, "../../public/vendor/tesseract");
  const same = (a, b) => assert.ok(readFileSync(a).equals(readFileSync(b)), `${b} differs from ${a}`);
  same(path.join(tesseract, "dist/worker.min.js"), path.join(vendor, "worker.min.js"));
  same(path.join(core, "tesseract-core-simd-lstm.wasm.js"), path.join(vendor, "tesseract-core-simd-lstm.wasm.js"));
  const model = readFileSync(path.join(vendor, "eng.traineddata.gz"));
  assert.deepEqual([model[0], model[1]], [0x1f, 0x8b]);
});

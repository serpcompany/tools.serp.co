import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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

// A JPEG header with only what imageSize reads: optional fill bytes, an EXIF
// APP1 segment with an Orientation tag, and a baseline start-of-frame.
function jpegHeader({ width, height, orientation, fill = 0, littleEndian = false }) {
  const bytes = [0xff, 0xd8];
  for (let i = 0; i < fill; i += 1) bytes.push(0xff);
  if (orientation) {
    const u16 = (value) => (littleEndian ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
    const u32 = (value) => (littleEndian ? [value & 0xff, (value >> 8) & 0xff, 0, 0] : [0, 0, (value >> 8) & 0xff, value & 0xff]);
    const tiff = [
      ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8),
      ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0),
    ];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload);
  }
  bytes.push(0xff, 0xc0, 0, 11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0);
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes).buffer;
}

test("JPEG sizing skips fill bytes and follows the EXIF orientation", () => {
  assert.deepEqual(imageSize(jpegHeader({ width: 400, height: 300, fill: 3 }), "jpg"), { width: 400, height: 300 });
  for (const littleEndian of [false, true]) {
    for (const orientation of [1, 2, 3, 4]) {
      assert.deepEqual(imageSize(jpegHeader({ width: 400, height: 300, orientation, littleEndian }), "jpg"), { width: 400, height: 300 });
    }
    // 5-8 rotate a quarter turn: a sensor-landscape photo is shown portrait.
    for (const orientation of [5, 6, 7, 8]) {
      assert.deepEqual(imageSize(jpegHeader({ width: 400, height: 300, orientation, littleEndian }), "jpg"), { width: 300, height: 400 });
    }
  }
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

test("a tall image is scaled down to the 9-inch text height, keeping its shape", async () => {
  const tall = new Uint8Array(read("sample-text.png"));
  new DataView(tall.buffer).setUint32(16, 600);
  new DataView(tall.buffer).setUint32(20, 6000);
  const files = unzipSync(new Uint8Array(await imageToDocx(tall.buffer, "png")));
  const [, cx, cy] = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(strFromU8(files["word/document.xml"]));
  assert.ok(Math.abs(Number(cy) - 9 * EMU_PER_INCH) < EMU_PER_INCH / 100, cy);
  assert.ok(Math.abs(Number(cx) / Number(cy) - 0.1) < 0.001, `${cx} x ${cy}`);
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
  // @tesseract.js-data/eng@1.0.0, 4.0.0_best_int/eng.traineddata.gz.
  const model = readFileSync(path.join(vendor, "eng.traineddata.gz"));
  assert.equal(
    createHash("sha256").update(model).digest("hex"),
    "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91",
  );
});

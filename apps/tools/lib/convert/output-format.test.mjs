import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkOutputFormat } from "./output-format.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const read = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

test("real sample files pass the check for their own format", () => {
  const formats = [
    "png", "apng", "jpg", "jfif", "gif", "webp", "bmp", "tif", "tiff", "ico", "cur", "psd",
    "dds", "avif", "heic", "svg", "pdf", "mp3", "wav", "ogg", "oga", "ogv", "opus", "flac",
    "aiff", "aif", "aifc", "webm", "mkv", "mp4", "m4a", "m4v", "m4r", "mov", "3gp", "3g2",
    "avi", "flv",
  ];
  const checked = formats.filter((format) => existsSync(path.join(fixtures, `sample.${format}`)));
  assert.ok(checked.length > 30, `only ${checked.length} fixtures found`);
  for (const format of checked) {
    assert.deepEqual(checkOutputFormat(read(`sample.${format}`), format), { ok: true }, format);
  }
});

test("a PNG saved as GIF, TIFF or ICO is caught and named", () => {
  for (const to of ["gif", "tiff", "ico", "jpg", "webp"]) {
    assert.deepEqual(checkOutputFormat(read("sample.png"), to), {
      ok: false,
      expected: to,
      detected: "png",
    });
  }
});

test("audio in the wrong container is caught", () => {
  assert.deepEqual(checkOutputFormat(read("sample.wav"), "mp3"), {
    ok: false,
    expected: "mp3",
    detected: "wav",
  });
});

test("formats without a reliable signature aren't checked", () => {
  for (const to of ["tga", "csv", "txt", "markdown", "json"]) {
    assert.deepEqual(checkOutputFormat(read("sample.png"), to), { ok: true }, to);
  }
});

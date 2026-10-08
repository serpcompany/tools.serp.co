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
    "avi", "flv", "av1", "hevc",
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

test("an .av1 must be AV1 in IVF and an .hevc a raw H.265 stream, not an MP4 named that way", () => {
  for (const to of ["av1", "hevc"]) {
    assert.deepEqual(checkOutputFormat(read("sample.mp4"), to), { ok: false, expected: to, detected: "mp4" });
  }
  const bytes = (...values) => Uint8Array.from(values).buffer;
  // VP8 in IVF, and an H.264 stream starting with its SPS.
  const vp8Ivf = [..."DKIF"].map((c) => c.charCodeAt(0)).concat([0, 0, 32, 0], [..."VP80"].map((c) => c.charCodeAt(0)));
  assert.equal(checkOutputFormat(bytes(...vp8Ivf), "av1").ok, false);
  assert.equal(checkOutputFormat(bytes(0, 0, 0, 1, 0x67, 0x42), "hevc").ok, false);
  // A three-byte start code and an access unit delimiter first are both fine.
  assert.equal(checkOutputFormat(bytes(0, 0, 1, 0x46, 0x01, 0x50), "hevc").ok, true);
});

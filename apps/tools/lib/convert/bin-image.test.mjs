import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { binImageFormat, notAnImageMessage, unreadableImageMessage } from "./bin-image.ts";
import { imageFormatOf } from "./image-pdf-inputs.ts";
import { checkInputFile, convertWithWorker } from "./workerClient.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const bytes = (name) => new Uint8Array(readFileSync(path.join(fixtures, name)));
const buffer = (data) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

test("a .bin file's picture is found by its first bytes, in every format the engines read", () => {
  const expected = {
    "sample.bin": "jpg",
    "sample.jpg": "jpg",
    "sample.png": "png",
    "sample.gif": "gif",
    "sample.webp": "webp",
    "sample.bmp": "bmp",
    "sample.tif": "tiff",
    "sample-tiff.bin": "tiff",
    "sample.ico": "ico",
    "sample.avif": "avif",
    "sample.heic": "heic",
    "sample-heic.bin": "heic",
    "sample.psd": "psd",
    "sample.jxl": "jxl",
    "sample.jp2": "jp2",
    "sample.exr": "exr",
    "sample.hdr": "hdr",
    "sample.xcf": "xcf",
    "sample.dds": "dds",
    "sample.icns": "icns",
    // Camera RAW that's TIFF underneath reads as TIFF.
    "sample.nef": "tiff",
  };
  for (const [name, format] of Object.entries(expected)) assert.equal(binImageFormat(bytes(name)), format, name);
});

test("files that aren't pictures are found to be none", () => {
  for (const name of [
    "not-an-image.bin",
    "tika-drm.m4p",
    "sample.mp4",
    "sample.mpeg",
    "sample.mp3",
    "sample.wav",
    "sample.pdf",
    "sample.txt",
    "sample.docx",
    "sample.cr3",
    "sample.ttf",
  ]) {
    assert.equal(binImageFormat(bytes(name)), null, name);
  }
  assert.equal(binImageFormat(new Uint8Array()), null, "an empty file");
  // A start too short to be sure of: two bytes of a JPEG, "BM" and nothing.
  assert.equal(binImageFormat(new Uint8Array([0xff, 0xd8])), null);
  assert.equal(binImageFormat(new TextEncoder().encode("BM, then a text file")), null);
  // An MPEG program stream starts 00 00 01 BA, an icon 00 00 01 00 and a count.
  assert.equal(binImageFormat(new Uint8Array([0, 0, 1, 0, 0, 0, 16, 16, 0, 0, 1, 0, 32, 0])), null, "an icon of no images");
});

test("Image to PDF still trusts only JPEG, PNG, GIF, WebP, HEIC and AVIF over the file's name", () => {
  assert.equal(imageFormatOf("scan.bin", bytes("sample-tiff.bin")), null);
  assert.equal(imageFormatOf("scan.png", bytes("sample-tiff.bin")), "png");
  assert.equal(imageFormatOf("photo.bin", bytes("sample-heic.bin")), "heic");
  assert.equal(imageFormatOf("raw.nef", bytes("sample.nef")), "nef");
});

test("the messages say what the file is and what converts", () => {
  assert.match(notAnImageMessage("png"), /^This file isn't an image, so it can't become a PNG\./);
  assert.match(notAnImageMessage("jpg"), /ATT00001\.bin.*firmware, disc images/);
  assert.match(unreadableImageMessage("jpg"), /starts like a JPEG image.*damaged or incomplete/);
  assert.match(unreadableImageMessage("tiff"), /starts like a TIFF image/);
});

// A file whose whole contents can't be read, as a browser's File for a disc
// image of several gigabytes would be: only its first bytes are.
function hugeFile(head) {
  return {
    size: 4.7e9,
    slice: (start, end) => new Blob([head.subarray(start, Math.min(end, head.length))]),
    arrayBuffer: () => {
      throw new Error("read whole");
    },
  };
}

test("the page refuses a .bin that isn't a picture from its first bytes, before reading the rest", async () => {
  const refused = { telemetryCode: "not_an_image", message: notAnImageMessage("jpg") };
  await assert.rejects(checkInputFile(hugeFile(bytes("not-an-image.bin")), "bin", "jpg"), refused);
  await assert.rejects(checkInputFile(hugeFile(new Uint8Array()), "BIN", "JPG"), refused);
  await checkInputFile(hugeFile(bytes("sample.bin")), "bin", "jpg");
  // Other inputs aren't read at all.
  await checkInputFile(hugeFile(bytes("not-an-image.bin")), "png", "jpg");
});

// A worker that answers each raster job with `reply`, and records the jobs.
function fakeWorker(reply) {
  const jobs = [];
  const worker = {
    postMessage(job) {
      jobs.push(job);
      queueMicrotask(() => worker.onmessage({ data: reply(job) }));
    },
  };
  return { worker, jobs };
}

test("a picture in a .bin is converted as the format its bytes say", async () => {
  const png = bytes("sample.png");
  const { worker, jobs } = fakeWorker(() => ({ ok: true, blob: buffer(png) }));
  const result = await convertWithWorker({ worker, from: "bin", to: "png", buf: buffer(bytes("sample.bin")) });
  assert.deepEqual(new Uint8Array(result.buffer), png);
  assert.deepEqual(jobs.map((job) => [job.op, job.from, job.to]), [["raster", "jpg", "png"]]);
});

test("a .bin that holds no picture is refused before any engine runs", async () => {
  const { worker, jobs } = fakeWorker(() => assert.fail("no engine should run"));
  await assert.rejects(
    convertWithWorker({ worker, from: "bin", to: "png", buf: buffer(bytes("not-an-image.bin")) }),
    { telemetryCode: "not_an_image", message: notAnImageMessage("png"), telemetryMetadata: { from: "bin", to: "png", engine: "bin-image" } },
  );
  assert.equal(jobs.length, 0);
});

test("a .bin that starts like a picture but doesn't decode says the picture is damaged", async () => {
  // The first 200 bytes of a JPEG: its markers, cut short. The worker fails
  // to decode it, and so does the page (no browser decoders in Node).
  const cut = bytes("sample.jpg").slice(0, 200);
  const { worker } = fakeWorker(() => ({ ok: false, error: "The source image cannot be decoded." }));
  const error = await convertWithWorker({ worker, from: "bin", to: "jpg", buf: buffer(cut) }).catch((caught) => caught);
  assert.equal(error.telemetryCode, "unreadable_image");
  assert.equal(error.message, unreadableImageMessage("jpg"));
  assert.deepEqual(error.telemetryMetadata, { from: "bin", to: "jpg", format: "jpg", engine: "bin-image" });
  assert.ok(error.cause instanceof Error, "the engine's own error is kept as the cause");
});

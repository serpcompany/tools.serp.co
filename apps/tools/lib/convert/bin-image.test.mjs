import test from "node:test";
import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  IMAGE_NAMES,
  binConvertFailedMessage,
  binImageFormat,
  binPicture,
  notAnImageMessage,
  tooLargeImageMessage,
  unreadableImageMessage,
} from "./bin-image.ts";
import { DECODE_INPUTS, browserSample } from "./decode.ts";
import { isDecodeFailure, noBrowserDecoderMessage } from "./decode-failure.ts";
import { IMAGE_PDF_INPUTS, imageFormatOf } from "./image-pdf-inputs.ts";
import { NO_SIGNATURE } from "./image-signature.ts";
import { MAGICK_BROWSER_INPUTS } from "./magickBrowser.ts";
import { sfwToJpeg } from "./sfw.ts";
import { decodeKtx1 } from "./texture-formats.ts";
import { checkInputFile, convertWithWorker } from "./workerClient.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const bytes = (name) => new Uint8Array(readFileSync(path.join(fixtures, name)));
const buffer = (data) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const text = (value) => new TextEncoder().encode(value);

// A real cursor: sample.cur is an icon (type 1) named .cur, so this is it
// as type 2, with a hotspot where an icon has its planes and bit count.
function cursor() {
  const cur = bytes("sample.cur");
  cur[2] = 2;
  cur.set([4, 0, 4, 0], 10);
  return cur;
}

// A Canon CR2's header: a TIFF header, then "CR", version 2.
function canonCr2() {
  const head = new Uint8Array(64);
  head.set([0x49, 0x49, 0x2a, 0, 16, 0, 0, 0, 0x43, 0x52, 2, 0]);
  return head;
}

// `data` in a MacBinary II wrapper, as a Mac saves a file for other systems.
function macBinary(data, type = "????", name = "picture") {
  const out = new Uint8Array(128 + Math.ceil(data.length / 128) * 128);
  out[1] = name.length;
  out.set(text(name), 2);
  out.set(text(type), 65);
  out.set(text("????"), 69);
  new DataView(out.buffer).setUint32(83, data.length);
  out[122] = 129;
  out[123] = 129;
  out.set(data, 128);
  return out;
}

// Names an engine input may be read under, and the format found for it.
const SAME_AS = { jpeg: "jpg", jfif: "jpg", jif: "jpg", jps: "jpg", tif: "tiff", heif: "heic" };
// What each format is checked with: its sample fixture, unless that fixture
// isn't one (sample.cur is an icon, sample.cr2 a DNG).
const SAMPLES = { tiff: () => bytes("sample.tif"), cur: cursor, cr2: canonCr2 };

test("a .bin file's picture is found by its first bytes, in every format the site's engines read", () => {
  const inputs = new Set([...MAGICK_BROWSER_INPUTS, ...DECODE_INPUTS, ...IMAGE_PDF_INPUTS]);
  for (const input of [...inputs].sort()) {
    if (NO_SIGNATURE[input]) continue;
    const format = SAME_AS[input] ?? input;
    const sample = SAMPLES[format]?.() ?? (existsSync(path.join(fixtures, `sample.${format}`)) && bytes(`sample.${format}`));
    assert.ok(sample, `${input}: no signature in image-signature.ts, nor a NO_SIGNATURE entry (no sample.${format} to check one with)`);
    assert.equal(binImageFormat(sample), format, `${input}: no signature in image-signature.ts, nor a NO_SIGNATURE entry`);
    assert.ok(IMAGE_NAMES[format], `${format} has a name for the messages`);
  }
  for (const input of Object.keys(NO_SIGNATURE)) assert.ok(inputs.has(input), `${input} in NO_SIGNATURE is an engine input`);
  // The fixtures saved as .bin, and those named for another format.
  const named = {
    "sample.bin": "jpg",
    "sample-tiff.bin": "tiff",
    "sample-heic.bin": "heic",
    "sample.cur": "ico",
    "sample.cr2": "dng",
    "sample.apng": "png",
  };
  for (const [name, format] of Object.entries(named)) assert.equal(binImageFormat(bytes(name)), format, name);
});

test("camera RAW that's TIFF underneath goes to the RAW decoder; a TIFF from anything else stays a TIFF", () => {
  assert.equal(binImageFormat(bytes("sample.nef")), "nef");
  assert.equal(binImageFormat(bytes("sample.arw")), "arw");
  assert.equal(binImageFormat(bytes("sample.dng")), "dng");
  assert.equal(binImageFormat(bytes("sample.tif")), "tiff");
  // A Nikon scanner's TIFF: the maker, but its first directory is the image.
  const scan = new Uint8Array(64);
  scan.set([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x0f, 0x01, 2, 0, 6, 0, 0, 0, 26, 0, 0, 0]);
  scan.set(text("NIKON\0"), 26);
  assert.equal(binImageFormat(scan), "tiff");
  // The same with SubIFDs, as a NEF has.
  const nef = scan.slice();
  nef.set([2, 0, 0x0f, 0x01, 2, 0, 6, 0, 0, 0, 40, 0, 0, 0, 0x4a, 0x01, 4, 0, 1, 0, 0, 0, 0, 0, 0, 0], 8);
  nef.set(text("NIKON\0"), 40);
  assert.equal(binImageFormat(nef), "nef");
});

test("an SVG is found after a byte order mark, XML declaration, comments and doctype", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  const prolog =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Adobe Illustrator 27.0 -->\n' +
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
    '  <!ENTITY ns_flows "http://ns.adobe.com/Flows/1.0/">\n]>\n';
  for (const file of [svg, `  \n${svg}`, `\ufeff${svg}`, prolog + svg, "<svg>\n</svg>"]) {
    assert.equal(binImageFormat(text(file)), "svg", file.slice(0, 40));
  }
  for (const file of [
    '<!DOCTYPE html><html><body><svg width="1" height="1"></svg></body></html>',
    '<?xml version="1.0"?><rss version="2.0"></rss>',
    "<svgfont/>",
    `<!-- ${"x".repeat(5000)} -->${svg}`,
  ]) {
    assert.equal(binImageFormat(text(file)), null, file.slice(0, 40));
  }
});

test("Netpbm, PCX, WPG and TGA headers are checked beyond their first bytes", () => {
  assert.equal(binImageFormat(text("P6\n# made by hand\n2 1\n255\nabcdef")), "ppm");
  assert.equal(binImageFormat(text("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 3\nMAXVAL 255\nENDHDR\nabc")), "pam");
  assert.equal(binImageFormat(text("P3 meeting notes")), null);
  assert.equal(binImageFormat(text("P8\n2 1\n")), null);
  // A WordPerfect document has WPG's header with file type 0x0A, not 0x16.
  const document = bytes("sample.wpg").slice(0, 64);
  document[9] = 0x0a;
  assert.equal(binImageFormat(document), null);
  // A TGA whose pixels are missing, and a file of zeros.
  assert.equal(binImageFormat(bytes("sample.tga").slice(0, 1000)), null);
  assert.equal(binImageFormat(new Uint8Array(8192)), null);
});

test("a picture in a MacBinary wrapper is found in its data fork", () => {
  const png = bytes("sample.png");
  assert.deepEqual(binPicture(macBinary(png, "PNGf"), 128 + Math.ceil(png.length / 128) * 128), {
    format: "png",
    start: 128,
    end: 128 + png.length,
  });
  // MacPaint has no signature of its own; its MacBinary type says what it is.
  assert.equal(binImageFormat(macBinary(bytes("sample.mac"), "PNTG")), "mac");
  assert.equal(binImageFormat(macBinary(bytes("sample.pdf"), "PDF ")), null);
  assert.equal(binImageFormat(macBinary(new Uint8Array(), "PNGf")), null, "no data fork");
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
    "sample.ttf",
    "sample.otf",
    "sample.html",
    "sample.xml",
    "sample.eps",
  ]) {
    assert.equal(binImageFormat(bytes(name)), null, name);
  }
  assert.equal(binImageFormat(new Uint8Array()), null, "an empty file");
  // A start too short to be sure of: two bytes of a JPEG, "BM" and nothing.
  assert.equal(binImageFormat(new Uint8Array([0xff, 0xd8])), null);
  assert.equal(binImageFormat(text("BM, then a text file")), null);
  // An MPEG program stream starts 00 00 01 BA, an icon 00 00 01 00 and a count.
  assert.equal(binImageFormat(new Uint8Array([0, 0, 1, 0, 0, 0, 16, 16, 0, 0, 1, 0, 32, 0])), null, "an icon of no images");
  assert.equal(binImageFormat(new Uint8Array([0, 0, 2, 0, 1, 0, 16, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null, "a cursor with no image");
});

test("Image to PDF still trusts only JPEG, PNG, GIF, WebP, HEIC and AVIF over the file's name", () => {
  assert.equal(imageFormatOf("scan.bin", bytes("sample-tiff.bin")), null);
  assert.equal(imageFormatOf("scan.png", bytes("sample-tiff.bin")), "png");
  assert.equal(imageFormatOf("photo.bin", bytes("sample-heic.bin")), "heic");
  assert.equal(imageFormatOf("raw.nef", bytes("sample.nef")), "nef");
  assert.equal(imageFormatOf("drawing.bin", bytes("sample.svg")), null);
});

test("the messages say what the file is and what converts, with the right article", () => {
  assert.match(notAnImageMessage("png"), /^This file isn't an image, so it can't become a PNG\./);
  assert.match(notAnImageMessage("jpg"), /Only pictures saved as \.bin files convert, such as Outlook's ATT00001\.bin attachments\.$/);
  assert.match(unreadableImageMessage("jpg"), /starts like a JPEG image.*damaged or incomplete/);
  for (const format of ["avif", "ico", "exr", "hdr", "xcf", "svg", "icns", "xpm", "sfw", "orf"]) {
    assert.match(unreadableImageMessage(format), /^This file starts like an [A-Z]/, format);
  }
  for (const format of ["tiff", "heic", "png", "cur", "ktx", "pcx", "tga", "mac", "nef"]) {
    assert.match(unreadableImageMessage(format), /^This file starts like a [A-Z]/, format);
  }
  assert.match(unreadableImageMessage("nef"), /starts like a Nikon NEF image/);
  assert.match(tooLargeImageMessage("psd"), /^This file starts like a PSD image, .*: it may be damaged, or too large to convert here\.$/);
  assert.equal(
    noBrowserDecoderMessage("webp"),
    "This browser can't open WebP files; try a current Chrome, Edge, Firefox or Safari.",
  );
  assert.equal(
    binConvertFailedMessage("avif", "png"),
    "The AVIF image in this file couldn't be converted to PNG. Try again, or reload the page.",
  );
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
  await checkInputFile(hugeFile(bytes("sample.pcd")), "bin", "jpg");
  await checkInputFile(hugeFile(macBinary(bytes("sample.png"), "PNGf")), "bin", "jpg");
  // Other inputs aren't read at all.
  await checkInputFile(hugeFile(bytes("not-an-image.bin")), "png", "jpg");
});

// A worker that answers each raster job with `reply`, and records the jobs.
function fakeWorker(reply) {
  const jobs = [];
  const worker = {
    postMessage(job) {
      jobs.push({ ...job, buf: new Uint8Array(job.buf.slice(0)) });
      queueMicrotask(() => worker.onmessage({ data: reply(job) }));
    },
  };
  return { worker, jobs };
}

const pngReply = () => ({ ok: true, blob: buffer(bytes("sample.png")) });

test("a picture in a .bin is converted as the format its bytes say, from where its bytes start", async () => {
  const { worker, jobs } = fakeWorker(pngReply);
  const result = await convertWithWorker({ worker, from: "bin", to: "png", buf: buffer(bytes("sample.bin")) });
  assert.deepEqual(new Uint8Array(result.buffer), bytes("sample.png"));
  assert.deepEqual(jobs.map((job) => [job.op, job.from, job.to]), [["raster", "jpg", "png"]]);
  // In MacBinary: the data fork alone, without the header or padding.
  const cur = cursor();
  await convertWithWorker({ worker, from: "bin", to: "png", buf: buffer(macBinary(cur, "curs")) });
  assert.deepEqual([jobs[1].from, jobs[1].buf], ["cur", cur]);
});

test("a .bin that holds no picture is refused before any engine runs", async () => {
  const { worker, jobs } = fakeWorker(() => assert.fail("no engine should run"));
  await assert.rejects(
    convertWithWorker({ worker, from: "bin", to: "png", buf: buffer(bytes("not-an-image.bin")) }),
    { telemetryCode: "not_an_image", message: notAnImageMessage("png"), telemetryMetadata: { from: "bin", to: "png", engine: "bin-image" } },
  );
  assert.equal(jobs.length, 0);
});

// The real ImageMagick WASM build, served as the page fetches it; until
// `serveMagick` is set, the fetch fails as an outage would.
const require = createRequire(import.meta.url);
const wasm = readFileSync(path.join(path.dirname(require.resolve("@imagemagick/magick-wasm")), "magick.wasm"));
let serveMagick = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => (serveMagick ? new Response(wasm) : new Response(null, { status: 503 }));
test.after(() => {
  globalThis.fetch = originalFetch;
});

const noWorker = fakeWorker(() => assert.fail("no worker job")).worker;
const failure = (promise) => promise.then(() => assert.fail("expected a failure"), (error) => error);

test("an engine that fails to load or runs out of memory isn't reported as a damaged picture", async () => {
  // ImageMagick doesn't load.
  const outage = await failure(convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(bytes("sample-tiff.bin")) }));
  assert.equal(outage.message, binConvertFailedMessage("tiff", "png"));
  assert.equal(outage.telemetryCode, "convert_failed");
  assert.deepEqual(outage.telemetryMetadata, { from: "bin", to: "png", format: "tiff", engine: "browser-magick" });
  assert.match(outage.cause.message, /Couldn't load the image converter \(503\)/);
  // The worker runs out of memory.
  const { worker } = fakeWorker(() => ({ ok: false, error: "Array buffer allocation failed" }));
  const memory = await failure(convertWithWorker({ worker, from: "bin", to: "jpg", buf: buffer(bytes("sample.bin")) }));
  assert.equal(memory.message, binConvertFailedMessage("jpg", "jpg"));
  assert.equal(memory.telemetryCode, "worker_convert_failed");
  assert.deepEqual(memory.telemetryMetadata, { op: "raster", from: "bin", to: "jpg", format: "jpg", engine: "worker" });
});

test("a .bin whose picture a decoder can't read says the picture is damaged", async () => {
  serveMagick = true;
  // A TIFF header followed by noise: libtiff (CoderError), and a PPM cut
  // short (CorruptImageError).
  const tiff = new Uint8Array(3000).map((_, index) => (index * 7919) & 255);
  tiff.set([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]);
  for (const [data, format] of [[tiff, "tiff"], [bytes("sample.ppm").slice(0, 40), "ppm"]]) {
    const error = await failure(convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(data) }));
    assert.equal(error.message, unreadableImageMessage(format), format);
    assert.equal(error.telemetryCode, "unreadable_image");
    assert.deepEqual(error.telemetryMetadata, { from: "bin", to: "png", format, engine: "bin-image" });
    assert.ok(error.cause instanceof Error, "the decoder's own error is kept as the cause");
  }
  // A decoder in the worker, here KTX's, finds the file cut short.
  const cut = bytes("sample.ktx").slice(0, 100);
  assert.throws(() => decodeKtx1(cut), (error) => isDecodeFailure(error));
  assert.throws(() => sfwToJpeg(text("SFW94A and nothing else")), (error) => isDecodeFailure(error));
  const { worker } = fakeWorker(() => ({ ok: false, error: "The texture file is truncated.", decodeFailure: true }));
  const ktx = await failure(convertWithWorker({ worker, from: "bin", to: "png", buf: buffer(cut) }));
  assert.equal(ktx.message, unreadableImageMessage("ktx"));
});

test("a RAW photo saved as .bin is read by the RAW decoder, not as its small TIFF preview", async () => {
  serveMagick = true;
  const result = await convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(bytes("sample.nef")) });
  const png = new DataView(result.buffer);
  assert.deepEqual([png.getUint32(16), png.getUint32(20)], [3039, 2014]);
});

// A worker that leaves every picture to the page, as a browser's does when
// its decoders in workers fail.
const declined = fakeWorker(() => ({ ok: false, error: "This format isn’t natively supported by your browser." })).worker;
const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// Runs `run` on a page whose browser has neither ImageDecoder nor
// createImageBitmap (as in Node), only an <img>, which loads the files
// `decodes(bytes)` accepts and fails on the rest. `tried` lists the files it
// was given.
async function onPage(decodes, run) {
  const tried = [];
  const context = { drawImage() {}, getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }) };
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  globalThis.Image = class {
    naturalWidth = 1;
    naturalHeight = 1;
    set src(url) {
      resolveObjectURL(url).arrayBuffer().then((data) => {
        const file = new Uint8Array(data);
        tried.push(file);
        (decodes(file) ? this.onload : this.onerror)();
      });
    }
  };
  try {
    return await run(tried);
  } finally {
    delete globalThis.document;
    delete globalThis.Image;
  }
}

test("each format the browser decodes has a 1 x 1 sample of it, to tell a browser without its decoder", async () => {
  serveMagick = true;
  const magick = await import("@imagemagick/magick-wasm");
  for (const format of [...DECODE_INPUTS, "cur"].filter((format) => !["heic", "heif", "ktx", "ktx2", "icns", "tiff"].includes(format))) {
    const sample = browserSample(format);
    assert.ok(sample, `${format} has a sample`);
    assert.equal(binImageFormat(sample), SAME_AS[format] ?? format, format);
    if (format === "svg") continue;
    const name = { jpg: "jpeg", cur: "ico" }[format] ?? format;
    const magickFormat = magick.MagickFormat[Object.keys(magick.MagickFormat).find((key) => key.toLowerCase() === name)];
    const size = magick.ImageMagick.read(sample, magickFormat, (image) => [image.width, image.height]);
    assert.deepEqual(size, [1, 1], format);
  }
  assert.equal(browserSample("tiff"), null, "only Safari decodes TIFF; the converters send it to ImageMagick");
});

test("a browser without a decoder for the format isn't told the file is damaged", async () => {
  serveMagick = true;
  // No AVIF decoder (Safari before 16.4): ImageMagick reads the picture
  // instead. The browser's sample is decoded once, not once a file.
  const avif = browserSample("avif");
  await onPage((file) => binImageFormat(file) !== "avif", async (tried) => {
    for (let run = 0; run < 2; run += 1) {
      const result = await convertWithWorker({ worker: declined, from: "bin", to: "png", buf: buffer(bytes("sample.avif")) });
      const png = new DataView(result.buffer);
      assert.deepEqual([png.getUint32(16), png.getUint32(20)], [96, 96]);
    }
    assert.equal(tried.filter((file) => sameBytes(file, avif)).length, 1);
  });
  // A browser that decodes JPEG: a JPEG it can't load is damaged.
  const jpeg = browserSample("jpg");
  await onPage((file) => sameBytes(file, jpeg), async () => {
    const cut = await failure(convertWithWorker({ worker: declined, from: "bin", to: "png", buf: buffer(bytes("sample.jpg").slice(0, 200)) }));
    assert.equal(cut.message, unreadableImageMessage("jpg"));
    assert.equal(cut.telemetryCode, "unreadable_image");
  });
  // No SVG decoder, and no other engine here reads SVG.
  await onPage(() => false, async () => {
    const svg = text('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"/>');
    const none = await failure(convertWithWorker({ worker: declined, from: "bin", to: "png", buf: buffer(svg) }));
    assert.equal(none.message, "This browser can't open SVG files; try a current Chrome, Edge, Firefox or Safari.");
    assert.equal(none.telemetryCode, "convert_failed");
    assert.deepEqual(none.telemetryMetadata, { engine: "bin-image", from: "bin", to: "png", format: "svg" });
  });
});

// `data` (a TIFF-based RAW) with every image directory, SubIFDs included,
// declaring `size` x `size` pixels.
function declaringSize(data, size) {
  const view = new DataView(data.buffer, data.byteOffset);
  const little = data[0] === 0x49;
  const seen = new Set();
  const walk = (offset) => {
    for (; offset && !seen.has(offset); offset = view.getUint32(offset + 2 + view.getUint16(offset, little) * 12, little)) {
      seen.add(offset);
      for (let entry = offset + 2; entry < offset + 2 + view.getUint16(offset, little) * 12; entry += 12) {
        const tag = view.getUint16(entry, little);
        if ((tag === 256 || tag === 257) && view.getUint16(entry + 2, little) === 3) view.setUint16(entry + 8, size, little);
        else if (tag === 256 || tag === 257) view.setUint32(entry + 8, size, little);
        if (tag === 330 && view.getUint32(entry + 4, little) === 1) walk(view.getUint32(entry + 8, little));
      }
    }
  };
  walk(view.getUint32(4, little));
  return data;
}

test("a camera RAW or DDS cut short says the picture is damaged, whatever its reader throws", async () => {
  serveMagick = true;
  // LibRaw throws a C++ exception, which arrives as a bare number; DDS's
  // reader gives up without an error. A Panasonic RW2 cut to a third
  // converts, as far as LibRaw reads it.
  for (const name of ["sample.nef", "sample.dng", "sample.arw", "sample.cr2", "sample.cr3", "sample.crw", "sample.orf", "sample.raf", "sample.rw2"]) {
    const whole = bytes(name);
    const format = binImageFormat(whole);
    for (const part of name === "sample.rw2" ? [2] : [3, 2]) {
      const cut = whole.slice(0, Math.floor(whole.length / part));
      const error = await failure(convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(cut) }));
      assert.equal(error.message, unreadableImageMessage(format), `${name} cut to 1/${part}`);
      assert.equal(error.telemetryCode, "unreadable_image");
    }
  }
  const nef = await failure(convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(bytes("sample.nef").slice(0, 2e6)) }));
  assert.equal(nef.cause.message, "The RAW file ends before its picture does: it may be incomplete.");
  const dds = await failure(convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(bytes("sample.dds").slice(0, 2368)) }));
  assert.equal(dds.message, unreadableImageMessage("dds"));
  // The engine still converts after these.
  const result = await convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(bytes("sample.dds")) });
  assert.equal(new DataView(result.buffer).getUint32(16), 96);
});

test("a picture whose header declares a size too large to convert here says so; running out of memory doesn't", async () => {
  serveMagick = true;
  // LibRaw's own verdict: a DNG declaring 60,000 x 60,000 pixels.
  const dng = declaringSize(bytes("sample.dng"), 60000);
  const raw = await failure(convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(dng) }));
  assert.equal(raw.message, tooLargeImageMessage("dng"));
  assert.equal(raw.telemetryCode, "unreadable_image");
  // ImageMagick's ResourceLimitError (as a 30,000 x 30,000 PSD gives, after
  // half a minute): too large when the header declares a picture this
  // engine can't hold, and out of memory when it can.
  const magick = await import("@imagemagick/magick-wasm");
  const { read } = magick.ImageMagick;
  const xpm = (size) => text(`/* XPM */\nstatic char *x[] = {\n"${size} ${size} 1 1",\n"a c #ff0000",\n"a",\n};\n`);
  try {
    magick.ImageMagick.read = () => {
      throw new magick.MagickError("CacheResourcesExhausted", magick.MagickErrorSeverity.ResourceLimitError);
    };
    const huge = await failure(convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(xpm(60000)) }));
    assert.equal(huge.message, tooLargeImageMessage("xpm"));
    const ordinary = await failure(convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(bytes("sample.xpm")) }));
    assert.equal(ordinary.message, binConvertFailedMessage("xpm", "png"));
    assert.deepEqual(ordinary.telemetryMetadata, { from: "bin", to: "png", format: "xpm", engine: "browser-magick" });
    magick.ImageMagick.read = () => {
      throw new RangeError("Array buffer allocation failed");
    };
    const memory = await failure(convertWithWorker({ worker: noWorker, from: "bin", to: "png", buf: buffer(bytes("sample.xpm")) }));
    assert.equal(memory.message, binConvertFailedMessage("xpm", "png"));
  } finally {
    magick.ImageMagick.read = read;
  }
});

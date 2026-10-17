import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { jsPDF } from "jspdf";

import { sampleArtboard, sampleColours } from "../../benchmarks/make-pdf-fixtures.mjs";
import { topColour } from "../../scripts/lib/tool-sweep.mjs";
import { checkOutputFormat } from "./output-format.ts";

// PDF and AI to an image as the page runs it: the browser's own pdf.js (the
// copy in public/vendor/pdfjs, which loadPdfjs imports by its URL) drawing on
// @napi-rs/canvas, the canvas pdf.js uses in Node, standing in for the
// page's OffscreenCanvas; and the ImageMagick WASM build the site ships,
// loaded as the page loads it.
const installed = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const vendor = new URL("../../public/vendor/pdfjs/", import.meta.url).href;
const canvasModule = createRequire(installed).resolve("@napi-rs/canvas");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "/vendor/pdfjs/pdf.min.mjs") {
      return { url: `${vendor}pdf.min.mjs`, format: "module", shortCircuit: true };
    }
    if (specifier === "@napi-rs/canvas" && context.parentURL?.startsWith(vendor)) {
      return { url: pathToFileURL(canvasModule).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
// In Node, pdf.js runs its worker's code in this thread: the vendored worker's.
globalThis.pdfjsWorker = await import(`${vendor}pdf.worker.min.js`);
const { createCanvas, ImageData } = createRequire(installed)("@napi-rs/canvas");

// Every canvas encoding asked for, as [type, quality].
const encodings = [];
const ENCODINGS = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };
class OffscreenCanvas {
  #canvas;
  constructor(width, height) {
    this.#canvas = createCanvas(width, height);
  }
  get width() {
    return this.#canvas.width;
  }
  set width(value) {
    this.#canvas.width = value;
  }
  get height() {
    return this.#canvas.height;
  }
  set height(value) {
    this.#canvas.height = value;
  }
  getContext(type) {
    return this.#canvas.getContext(type);
  }
  // A browser saves a type it can't encode as PNG.
  async convertToBlob({ type = "image/png", quality } = {}) {
    encodings.push([type, quality]);
    const format = ENCODINGS[type] ?? "png";
    const bytes = await this.#canvas.encode(format, quality === undefined ? undefined : Math.round(quality * 100));
    return new Blob([bytes], { type: ENCODINGS[type] ? type : "image/png" });
  }
}
globalThis.OffscreenCanvas = OffscreenCanvas;
globalThis.ImageData = ImageData;

const require = createRequire(import.meta.url);
const wasm = readFileSync(path.join(path.dirname(require.resolve("@imagemagick/magick-wasm")), "magick.wasm"));
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(wasm);
test.after(() => {
  globalThis.fetch = originalFetch;
});

const { convertWithWorker, multipleOutputName } = await import("./workerClient.ts");
const { convertPdfPages, PDF_IMAGE_LIMITS } = await import("./pdf-images.ts");
const { MAX_RENDER_PIXELS } = await import("./pdf.ts");
const magick = await import("@imagemagick/magick-wasm");

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const read = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const arrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

// Each format's ImageMagick reader, for reading outputs back. RGB has no
// header: it's read as the page's size.
const READERS = {
  bmp: "Bmp", gif: "Gif", jpg: "Jpeg", jpeg: "Jpeg", png: "Png", ppm: "Ppm", psd: "Psd",
  tga: "Tga", tif: "Tiff", tiff: "Tiff", webp: "WebP",
};

// An output's pixels as 8-bit RGBA, with its size. `size` is the page's, for
// headerless RGB.
function pixels(buffer, format, size) {
  const bytes = new Uint8Array(buffer);
  if (format === "rgb") {
    assert.equal(bytes.length, size.width * size.height * 3, "RGB is width x height x 3 bytes");
    const rgba = new Uint8Array(size.width * size.height * 4);
    for (let pixel = 0; pixel < size.width * size.height; pixel += 1) {
      rgba.set(bytes.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
      rgba[pixel * 4 + 3] = 255;
    }
    return { ...size, rgba };
  }
  return magick.ImageMagick.read(bytes, magick.MagickFormat[READERS[format]], (image) => ({
    width: image.width,
    height: image.height,
    rgba: image.getPixels((all) => all.toByteArray(0, 0, image.width, image.height, "RGBA")),
  }));
}

function pixelAt(image, x, y) {
  const index = (y * image.width + x) * 4;
  return [...image.rgba.subarray(index, index + 4)];
}

// Colours as drawn, within a lossy encoder's (or GIF's palette's) error.
function assertColour(actual, expected, label, tolerance = 24) {
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Math.abs(actual[channel] - expected[channel]) <= tolerance, `${label}: ${actual} is not ${expected}`);
  }
  assert.equal(actual[3], 255, `${label}: opaque`);
}

// sample-colours.pdf, page by page: its size drawn (twice its size in
// points) and points on it, in pixels: the bare page, a shape, and a black
// shape at half opacity over the bare page.
const COLOUR_PAGES = [
  {
    width: 600,
    height: 400,
    points: [
      ["bare page", 590, 10, [255, 255, 255]],
      ["red rectangle", 100, 100, [220, 40, 40]],
      ["half-opacity black over the page", 450, 300, [128, 128, 128]],
    ],
  },
  {
    width: 400,
    height: 600,
    points: [
      ["bare page", 10, 590, [255, 255, 255]],
      ["orange rectangle", 200, 100, [240, 150, 20]],
    ],
  },
];
const ARTBOARD = {
  width: 720,
  height: 480,
  points: [
    ["bare page", 700, 460, [255, 255, 255]],
    ["blue circle", 180, 300, [30, 120, 200]],
    ["half-opacity black over the page", 325, 300, [138, 138, 138]],
  ],
};

// The nine Tools' formats (#284), and those PDF to PNG and JPG and the AI
// Tools already wrote.
const TARGETS = ["tiff", "tif", "psd", "bmp", "webp", "gif", "ppm", "rgb", "tga", "png", "jpg", "jpeg"];

function assertPages(result, to, pages) {
  assert.equal(result.kind, "multiple", to);
  assert.equal(result.buffers.length, pages.length, `${to}: one file a page`);
  result.buffers.forEach((buffer, index) => {
    const page = pages[index];
    const label = `${to}, page ${index + 1}`;
    assert.ok(checkOutputFormat(buffer, to).ok, `${label}: ${to.toUpperCase()} bytes`);
    const image = pixels(buffer, to, page);
    assert.deepEqual([image.width, image.height], [page.width, page.height], `${label}: size`);
    for (const [name, x, y, colour] of page.points) assertColour(pixelAt(image, x, y), colour, `${label}, ${name}`);
    assert.ok(topColour(image.rgba).share < 0.9, `${label}: not blank`);
  });
}

test("the PDF and AI fixtures are the ones make-pdf-fixtures.mjs writes", () => {
  assert.deepEqual(new Uint8Array(read("sample-colours.pdf")), sampleColours(), "run node benchmarks/make-pdf-fixtures.mjs");
  assert.deepEqual(new Uint8Array(read("sample-colours.ai")), sampleArtboard(), "run node benchmarks/make-pdf-fixtures.mjs");
});

test("PDF to an image saves each page in the target's own format, not PNG", async () => {
  for (const to of TARGETS) {
    const result = await convertWithWorker({ worker: undefined, from: "pdf", to, buf: read("sample-colours.pdf") });
    assertPages(result, to, COLOUR_PAGES);
  }
});

test("AI to an image goes the same way, to PSD too", async () => {
  for (const to of TARGETS) {
    const result = await convertWithWorker({ worker: undefined, from: "ai", to, buf: read("sample-colours.ai") });
    assertPages(result, to, [ARTBOARD]);
  }
});

test("PNG and JPEG are the canvas's own encodings, JPEG at 0.9, as PDF to PNG and JPG were", async () => {
  encodings.length = 0;
  await convertWithWorker({ worker: undefined, from: "pdf", to: "png", buf: read("sample-colours.pdf") });
  assert.deepEqual(encodings, [["image/png", undefined], ["image/png", undefined]]);
  encodings.length = 0;
  await convertWithWorker({ worker: undefined, from: "pdf", to: "jpg", buf: read("sample-colours.pdf") });
  assert.deepEqual(encodings, [["image/jpeg", 0.9], ["image/jpeg", 0.9]]);
});

test("each page is saved as <name>_page<N>, a single page as PDF to PNG saves it", () => {
  assert.equal(multipleOutputName("report.pdf", "tiff", 0), "report_page1.tiff");
  assert.equal(multipleOutputName("report.pdf", "tiff", 1), "report_page2.tiff");
  assert.equal(multipleOutputName("logo.v2.ai", "psd", 0), "logo.v2_page1.psd");
});

// A PDF of `pages` pages, each `width` x `height` pt, with a mark on each.
function makePdf(pages, width = 72, height = 72) {
  const doc = new jsPDF({ unit: "pt", format: [width, height], orientation: width > height ? "landscape" : "portrait" });
  for (let page = 1; page <= pages; page += 1) {
    if (page > 1) doc.addPage([width, height], width > height ? "landscape" : "portrait");
    doc.setFillColor(page % 255, 80, 160);
    doc.rect(width / 4, height / 4, width / 2, height / 2, "F");
  }
  return doc.output("arraybuffer");
}

test("a 100-page PDF becomes 100 files in page order, with progress as each page is done", async () => {
  const progress = [];
  const result = await convertWithWorker({
    worker: undefined,
    from: "pdf",
    to: "tiff",
    buf: makePdf(100),
    onProgress: (update) => progress.push(update.progress),
  });
  assert.equal(result.buffers.length, 100);
  for (const [index, buffer] of result.buffers.entries()) {
    const image = pixels(buffer, "tiff");
    assert.deepEqual([image.width, image.height], [144, 144]);
    assertColour(pixelAt(image, 72, 72), [(index + 1) % 255, 80, 160], `page ${index + 1}`, 1);
  }
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b), "progress only rises");
  assert.ok(progress.length >= 100, "a step a page");
  assert.equal(progress.at(-1), 100);
});

test("a page larger than the render limit is drawn within it, keeping its shape", async () => {
  const [buffer] = (await convertWithWorker({ worker: undefined, from: "pdf", to: "bmp", buf: makePdf(1, 14_400, 7_200) }))
    .buffers;
  const image = pixels(buffer, "bmp");
  assert.ok(image.width * image.height <= MAX_RENDER_PIXELS, `${image.width} x ${image.height}`);
  assert.ok(Math.abs(image.width / image.height - 2) < 0.01, `${image.width} x ${image.height} is 2:1`);
  assert.ok(image.width > 5_700, `${image.width} px wide: as large as the limit allows`);
});

test("a PDF past a limit is refused, saying which, before a page is drawn when that's known", async () => {
  encodings.length = 0;
  await assert.rejects(convertPdfPages(makePdf(4), "png", { limits: { pages: 3 } }), {
    code: "too_large",
    message: "This PDF has 4 pages; up to 3 can be converted to images here at once. Split it into smaller files and convert each.",
  });
  // Ten pages of 144 x 144 px, 4 bytes a pixel: 829,440 bytes of TIFF.
  await assert.rejects(convertPdfPages(makePdf(10), "tiff", { limits: { bytes: 400_000 } }), {
    code: "too_large",
    message:
      "This PDF's 10 pages are too large to convert to TIFF here at once: up to about 4 pages of their size can be. Split it into smaller files and convert each.",
  });
  assert.equal(encodings.length, 0, "no page was drawn");
  // PNG and JPEG are counted as they're made.
  await assert.rejects(convertPdfPages(makePdf(10), "png", { limits: { bytes: 1 } }), {
    code: "too_large",
    message:
      "This PDF's PNG images grew past what can be held here at once by page 1 of 10, so converting stopped. Split it into smaller files and convert each.",
  });
  assert.equal(encodings.length, 1, "stopped at the page that passed the limit");
  assert.deepEqual(PDF_IMAGE_LIMITS, { pages: 1_000, bytes: 1_000_000_000 });
});

// The telemetry code and message convertWithWorker fails with.
async function failure(from, to, buf) {
  try {
    await convertWithWorker({ worker: undefined, from, to, buf });
  } catch (error) {
    return { code: error.telemetryCode, message: error.message, metadata: error.telemetryMetadata };
  }
  assert.fail("it converted");
}

test("a password-protected, a damaged and a non-PDF file are each told why", async () => {
  assert.deepEqual(await failure("pdf", "tiff", read("sample-protected.pdf")), {
    code: "password_protected",
    message:
      "This PDF is password-protected, so its pages can't be opened here. Open it with its password, save or print a copy without one, and convert that copy.",
    metadata: { from: "pdf", to: "tiff", engine: "pdfjs" },
  });
  const damaged = "This file couldn't be read as a PDF: it may be damaged or incomplete, or not a PDF at all.";
  assert.deepEqual(await failure("pdf", "bmp", read("sample-truncated.pdf")), {
    code: "unreadable_pdf",
    message: damaged,
    metadata: { from: "pdf", to: "bmp", engine: "pdfjs" },
  });
  assert.equal((await failure("pdf", "png", read("sample.png"))).code, "unreadable_pdf");
  const truncatedAi = new Uint8Array(read("sample-colours.ai")).slice(0, 1_500);
  assert.deepEqual(await failure("ai", "psd", arrayBuffer(truncatedAi)), {
    code: "unreadable_pdf",
    message: "This AI file couldn't be read: the PDF inside it may be damaged or incomplete.",
    metadata: { from: "ai", to: "psd", engine: "pdfjs" },
  });
});

test("any other failure says to try again, and telemetry keeps the engine's error name", async () => {
  const { pdfImageFailure } = await import("./workerClient.ts");
  const crashed = Object.assign(new Error("worker gone"), { name: "UnknownErrorException" });
  const result = pdfImageFailure(crashed, "pdf", "tiff");
  assert.equal(result.message, "This PDF couldn't be converted to TIFF. Try again, or reload the page.");
  assert.equal(result.telemetryCode, "UnknownErrorException");
  assert.equal(result.cause, crashed);
  assert.equal(pdfImageFailure(new Error("no memory"), "ai", "psd").message, "This AI file couldn't be converted to PSD. Try again, or reload the page.");
});

test("two files converting at once each get their own pages", async () => {
  const [pdf, ai] = await Promise.all([
    convertWithWorker({ worker: undefined, from: "pdf", to: "tiff", buf: read("sample-colours.pdf") }),
    convertWithWorker({ worker: undefined, from: "ai", to: "tiff", buf: read("sample-colours.ai") }),
  ]);
  assertPages(pdf, "tiff", COLOUR_PAGES);
  assertPages(ai, "tiff", [ARTBOARD]);
});

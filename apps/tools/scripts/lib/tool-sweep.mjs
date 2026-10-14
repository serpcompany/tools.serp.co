// Pure helpers for scripts/tool-sweep.mjs: which active Tools the sweep can
// run and how, how one run's observation becomes a status, and how results
// merge across runs. The command drives the browser and does the I/O.

import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { requiresVideoConversion } from "../../lib/capabilities.ts";
import { resolveCompressionTarget } from "../../lib/compression-utils.ts";
import { MAGICK_BROWSER_INPUTS } from "../../lib/convert/magickBrowser.ts";
import { checkOutputFormat } from "../../lib/convert/output-format.ts";
import { usesWebCodecs } from "../../lib/convert/webcodecs.ts";
import {
  DOCUMENT_IMAGE_ENGINES,
  isDocumentImageConversion,
  isImageDocumentConversion,
  isImageTextConversion,
  isTableImageConversion,
} from "../../lib/convert/image-document-targets.ts";

export const STATUSES = ["pass", "wrong_format", "error", "timeout", "no_fixture", "skipped"];
// Statuses that come from running the Tool. A resumed run skips Tools that
// already have one, unless --retry names it.
export const MEASURED_STATUSES = new Set(["pass", "wrong_format", "error", "timeout"]);

export const DEFAULTS = {
  out: "benchmarks/tool-sweep-results.json",
  concurrency: 4,
  timeoutMs: 60_000,
  // FFmpeg loads 32 MB of wasm per page and runs single-threaded.
  ffmpegTimeoutMs: 180_000,
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Playwright's Chromium by default; an installed Chrome or Edge has the
// proprietary codecs (H.264, HEVC, AAC) that a Chromium build may lack.
export const CHANNELS = new Set(["chromium", "chrome", "chrome-beta", "msedge", "msedge-beta"]);

export function parseArgs(argv) {
  const args = {
    baseUrl: "",
    out: DEFAULTS.out,
    concurrency: DEFAULTS.concurrency,
    timeoutMs: DEFAULTS.timeoutMs,
    ffmpegTimeoutMs: DEFAULTS.ffmpegTimeoutMs,
    only: null,
    limit: null,
    resume: false,
    retry: new Set(),
    headed: false,
    channel: "chromium",
    summary: false,
  };
  const value = (index, name) => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`${name} needs a value`);
    return next;
  };
  const positiveInteger = (raw, name) => {
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
    return number;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") args.baseUrl = value(index++, arg).replace(/\/+$/, "");
    else if (arg === "--out") args.out = value(index++, arg);
    else if (arg === "--concurrency") args.concurrency = positiveInteger(value(index++, arg), arg);
    else if (arg === "--timeout") args.timeoutMs = positiveInteger(value(index++, arg), arg);
    else if (arg === "--ffmpeg-timeout") args.ffmpegTimeoutMs = positiveInteger(value(index++, arg), arg);
    else if (arg === "--only") args.only = splitList(value(index++, arg));
    else if (arg === "--limit") args.limit = positiveInteger(value(index++, arg), arg);
    else if (arg === "--resume") args.resume = true;
    else if (arg === "--retry") args.retry = new Set(splitList(value(index++, arg)));
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--channel") args.channel = value(index++, arg);
    else if (arg === "--summary") args.summary = true;
    else if (arg !== "--") throw new Error(`Unknown argument: ${arg}`);
  }
  for (const status of args.retry) {
    if (!MEASURED_STATUSES.has(status)) {
      throw new Error(`--retry takes measured statuses (${[...MEASURED_STATUSES].join(", ")}), not ${status}`);
    }
  }
  if (args.retry.size && !args.resume) throw new Error("--retry only applies with --resume");
  if (!CHANNELS.has(args.channel)) {
    throw new Error(`--channel takes ${[...CHANNELS].join(", ")}, not ${args.channel}`);
  }
  if (args.summary) return args;
  if (!args.baseUrl) throw new Error("--base-url is required");
  // Every run sends telemetry to the target's D1; thousands of runs belong in
  // a local database, never in staging's or production's.
  if (!LOCAL_HOSTS.has(new URL(args.baseUrl).hostname)) {
    throw new Error(`--base-url must be a local Worker (localhost), not ${args.baseUrl}`);
  }
  return args;
}

function splitList(raw) {
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

// The route of a page.tsx directory under app/, without route groups.
function routeOf(appDir, dir) {
  const parts = path.relative(appDir, dir).split(path.sep).filter((part) => part && !/^\(.*\)$/.test(part));
  return `/${parts.join("/")}`;
}

// The component a page renders: its first import from @/components outside
// sections/ (FAQ, how-to and link-hub sections sit under every Tool).
export function pageComponent(source) {
  const imports = source.matchAll(/import\s+(?:\{[^}]*\}|\w+)\s+from\s+["']@\/components\/([^"']+)["']/g);
  for (const [, modulePath] of imports) {
    if (!modulePath.startsWith("sections/")) return path.posix.basename(modulePath);
  }
  return "inline";
}

// Route -> component for every static page under app/. A Tool route that
// isn't here is served by app/(convert)/[tool]/page.tsx.
export function scanPageHandlers(appDir) {
  const handlers = new Map();
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("[")) visit(full);
      } else if (entry.name === "page.tsx") {
        handlers.set(routeOf(appDir, dir), pageComponent(readFileSync(full, "utf8")));
      }
    }
  };
  visit(appDir);
  return handlers;
}

// What app/(convert)/[tool]/page.tsx renders for a Tool without its own page.
export function dynamicRouteHandler(tool) {
  if ((tool.operation === "convert" || tool.operation === "compress") && tool.from && tool.to) {
    return "ToolPageRenderer";
  }
  if (tool.operation === "download") return "DownloaderPageRenderer";
  if (["video-editor", "image-editor", "audio-editor"].includes(tool.operation)) return "ToolPlaceholder";
  if (tool.operation === "view" || tool.operation === "edit") return "PdfToolPage";
  return "not-found";
}

export function handlerFor(tool, handlers) {
  return handlers.get(tool.route.replace(/\/+$/, "") || "/") ?? dynamicRouteHandler(tool);
}

// How each page is driven. ToolPageRenderer is the generic converter and
// compressor (HeroConverter or LanderHeroTwoColumn).
const DRIVERS = {
  ToolPageRenderer: "file",
  TableConvertLanding: "table",
  HtmlToMarkdownConverter: "html-to-markdown",
  JsonToCsv: "json-to-csv",
  CsvCombiner: "csv-combiner",
  BatchHeroConverter: "batch-compress",
};

const DOWNLOADER = "downloader: needs a real third-party media URL";
export const SKIP_REASONS = {
  DownloaderPageRenderer: DOWNLOADER,
  DownloaderPageTemplate: DOWNLOADER,
  TranscribeTool:
    "transcription: downloads a speech model and runs for minutes per file; measure it in a separate run",
  ToolPlaceholder: "coming-soon placeholder: nothing to run",
  PdfToolPage: "PDF viewer or editor: interactive, converts nothing",
  CharacterCounter: "text statistics: saves no file",
};

const ENGINES = {
  TableConvertLanding: "table-convert",
  HtmlToMarkdownConverter: "html-to-markdown-wasm",
  JsonToCsv: "javascript",
  CsvCombiner: "javascript",
  BatchHeroConverter: "jsquash-worker",
};

const COMPRESSION_ENGINES = {
  "image-worker": "jsquash-worker",
  "image-server": "server-image-compress",
  pdf: "server-pdf-compress",
  audio: "ffmpeg-wasm",
  video: "ffmpeg-wasm",
};

// The engine the generic converter page uses for a Tool: Image to PDF's own
// (lib/convert/image-pdf.ts, any image in), BIN's (the picture inside, by
// its first bytes), the branch order of
// compressFile and convertUnchecked in lib/convert/workerClient.ts, the AV1
// and HEVC Tools of lib/convert/webcodecs.ts, and the server-only outputs of
// shouldUseServerConversion in lib/convert/video.ts. Those try
// /api/video-convert first and fall back to FFmpeg in the browser when it
// fails, as it does on Workers. A label for grouping results; it decides
// nothing.
export function converterEngine({ operation, from, to }) {
  const source = from.toLowerCase();
  const target = to.toLowerCase();
  if (operation === "compress" && source === target) {
    const compression = resolveCompressionTarget(source);
    if (compression === "image-browser") return source === "svg" ? "svgo" : "imagemagick-wasm";
    return COMPRESSION_ENGINES[compression] ?? "unsupported";
  }
  if (source === "image" && target === "pdf") return "image-pdf";
  if (source === "ai" || source === "pdf") return "pdfjs";
  if (isImageDocumentConversion(source, target)) return "image-documents";
  if (isImageTextConversion(source, target)) return target === "txt" ? "tesseract" : "docx";
  if (isTableImageConversion(source, target)) return "table-outputs";
  if (isDocumentImageConversion(source, target)) return DOCUMENT_IMAGE_ENGINES[source];
  // The picture in a .bin is read by its format's engine (bin-image.ts).
  if (source === "bin") return "bin-image";
  if (MAGICK_BROWSER_INPUTS.has(source)) return "imagemagick-wasm";
  if (source === "heic" || source === "heif") return "heif-decoder";
  if (usesWebCodecs(source, target)) return "ffmpeg-wasm + webcodecs";
  if (requiresVideoConversion(source, target)) {
    // Mirrors shouldUseServerConversion in lib/convert/video.ts.
    const serverOnly =
      ["rm", "rmvb"].includes(target) || (source === "amr" && ["mp2", "oga", "ogg"].includes(target));
    return serverOnly ? "server-video, then ffmpeg-wasm" : "ffmpeg-wasm";
  }
  return "browser-raster";
}

export function engineFor(tool, handler) {
  if (handler === "ToolPageRenderer") return converterEngine(tool);
  return ENGINES[handler] ?? null;
}

// Where each engine label above runs a Tool's core operation, inferred from
// the code the label names (lib/convert/workerClient.ts and the routes it
// calls), not observed. The Tool status view (scripts/lib/tool-status.mjs)
// throws on a label that isn't here, so a new engine needs a line. Every
// label is listed: a "server-" prefix decides nothing. "unsupported" is left
// out on purpose: a compressor with no engine should stop the view.
export const ENGINE_LOCATIONS = {
  "ffmpeg-wasm": "client-only",
  "ffmpeg-wasm + webcodecs": "client-only",
  "imagemagick-wasm": "client-only",
  "browser-raster": "client-only",
  pdfjs: "client-only",
  "heif-decoder": "client-only",
  "table-convert": "client-only",
  "html-to-markdown-wasm": "client-only",
  javascript: "client-only",
  "jsquash-worker": "client-only",
  "image-documents": "client-only",
  tesseract: "client-only",
  docx: "client-only",
  "image-pdf": "client-only",
  "table-outputs": "client-only",
  "docx-preview": "client-only",
  "dxf-viewer": "client-only",
  "html-render": "client-only",
  "text-render": "client-only",
  "viz-js": "client-only",
  "xlsx-table": "client-only",
  "pptx-glimpse": "client-only",
  "bin-image": "client-only",
  svgo: "client-only",
  "server-image-compress": "server-executed",
  "server-pdf-compress": "server-executed",
  "server-video, then ffmpeg-wasm": "server-first-client-fallback",
};

// Strings from the text fixtures that a converted copy must still contain,
// so a text output (no byte signature) proves it holds the input's data.
const TEXT_MARKERS = {
  "sample.csv": "Alpha",
  "sample-2.csv": "Gamma",
  "sample.json": "Alpha",
  "sample.html": "Nova",
  "sample-text.png": "Tools",
  "sample-text.jpg": "Tools",
  // The table formats hold sample.csv's table.
  "sample.md": "Alpha",
  "sample.tex": "Alpha",
  "sample.wiki": "Alpha",
  "sample-mysql.txt": "Alpha",
  "sample.sql": "Alpha",
  "sample.xml": "Alpha",
  "sample.xlsx": "Alpha",
};
const TEXT_DRIVERS = new Set(["table", "html-to-markdown", "json-to-csv", "csv-combiner"]);

// Table outputs the page writes as files (lib/convert/table-outputs.ts)
// rather than as text in its output panel. The sweep opens each one and
// looks for the fixture's data in what it reads (decodeTableOutput); PNG and
// JPEG are checked as images instead.
export const TABLE_FILE_OUTPUTS = new Set(["excel", "pdf", "png", "jpeg", "avro", "protobuf"]);
const DECODED_TABLE_OUTPUTS = new Set(["excel", "pdf", "avro", "protobuf"]);

// Fixtures whose picture is a single colour when read back natively (most
// are 96x96 solid blue; a video's first frame, with FFmpeg). An image output
// of one is rightly one colour too, so the sweep can't tell it from a blank
// one and doesn't check its pixels. Every other fixture's image output must
// not be blank (see measurePixels).
export const ONE_COLOUR_FIXTURES = new Set([
  "sample.ai", "sample.avif", "sample.bin", "sample.bmp", "sample.cur", "sample.dds", "sample.gif",
  "sample.heic", "sample.heif", "sample.ico", "sample.jfif", "sample.jpg", "sample.pdf", "sample.png",
  "sample-2.png", "sample.psd", "sample.tga", "sample.tif", "sample.tiff", "sample.webp",
  // Videos.
  "sample.3gp", "sample.asf", "sample.av1", "sample.avchd", "sample.avi", "sample.divx", "sample.f4v",
  "sample.flv", "sample.hevc", "sample.m2ts", "sample.m4v", "sample.mjpeg", "sample.mkv", "sample.mov",
  "sample.mp4", "sample.mpeg", "sample.mpeg2", "sample.mpg", "sample.mts", "sample.mxf", "sample.ogv",
  "sample.rm", "sample.swf", "sample.ts", "sample.vob", "sample.webm", "sample.wmv",
]);

// Fixtures with several pages, and how many: a Tool that saves an image of
// each page must save this many, since a page left out (or two run
// together) passes every other check.
export const PAGE_COUNTS = {
  "sample-pages.docx": 3,
  // Its pages break where the text runs past them, not where the file says.
  "sample-long-table.docx": 4,
  // An image of each sheet that shows: two of three (one is hidden).
  "sample-sheets.xlsx": 2,
  // An image of each slide that shows: two of three (one is hidden).
  "sample-deck.pptx": 2,
};

// Inputs a Tool must refuse, by fixture name: the telemetry code of the
// refusal and words its message must hold. A format's `refusals` in
// fixture-matrix.json lists them; each Tool that reads the format is run once
// more with each, after its own fixture, and must show that message rather
// than convert the file or fail some other way.
export const EXPECTED_REFUSALS = {
  // A raw CD sector: a .bin that isn't a picture (lib/convert/bin-image.ts).
  "not-an-image.bin": { errorCode: "not_an_image", message: "isn't an image" },
  // Apache Tika's FairPlay test file (lib/convert/fairplay.ts).
  "tika-drm.m4p": { errorCode: "copy_protected", message: "copy-protected" },
};

// fixture-matrix.json: ready inputs by format, per-Tool fixtures, and the
// inputs each format's Tools must refuse.
export function loadFixtures(benchmarksDir) {
  const matrix = JSON.parse(readFileSync(path.join(benchmarksDir, "fixture-matrix.json"), "utf8"));
  const resolve = (relative) => path.join(benchmarksDir, relative);
  const byFormat = new Map();
  const refusals = new Map();
  for (const entry of matrix.formats ?? []) {
    if (entry.status === "ready" && entry.fixture) byFormat.set(entry.format, resolve(entry.fixture));
    if (entry.refusals?.length) refusals.set(entry.format, entry.refusals.map(resolve));
  }
  const byTool = new Map();
  for (const [toolId, entry] of Object.entries(matrix.toolFixtures ?? {})) {
    const files = entry.fixtures ?? (entry.fixture ? [entry.fixture] : []);
    if (files.length) byTool.set(toolId, files.map(resolve));
  }
  return { byFormat, byTool, refusals };
}

// Everything the sweep needs to know about one Tool before opening it. A plan
// with a status needs no browser.
export function planTool(tool, { handlers, fixtures, timeoutMs, ffmpegTimeoutMs }) {
  const handler = handlerFor(tool, handlers);
  const engine = engineFor(tool, handler);
  const base = { id: tool.id, route: tool.route, from: tool.from, to: tool.to, handler, engine };
  const driver = DRIVERS[handler];
  if (!driver) {
    return { ...base, status: "skipped", reason: SKIP_REASONS[handler] ?? `no sweep driver for ${handler}` };
  }
  const files =
    fixtures.byTool.get(tool.id) ?? (fixtures.byFormat.has(tool.from) ? [fixtures.byFormat.get(tool.from)] : null);
  if (!files) {
    return { ...base, status: "no_fixture", reason: `no ready ${tool.from} fixture in fixture-matrix.json` };
  }
  // A text output has no byte signature: without the fixture's data to look
  // for, a pass would prove nothing. An image can't be searched for text;
  // its pixels are checked instead.
  const target = tool.to?.toLowerCase();
  const tableFile = driver === "table" && TABLE_FILE_OUTPUTS.has(target);
  const textOutput = (TEXT_DRIVERS.has(driver) && !checksPixels(target)) || target === "txt";
  const markers = textOutput ? files.map((file) => TEXT_MARKERS[path.basename(file)]) : [];
  if (markers.some((marker) => !marker)) {
    return { ...base, status: "no_fixture", reason: `no data marker for the ${tool.from} fixture in TEXT_MARKERS` };
  }
  // Only the generic converter page is driven with a refusal.
  const refusals = driver === "file" ? (fixtures.refusals?.get(tool.from) ?? []) : [];
  const unexpected = refusals.find((file) => !EXPECTED_REFUSALS[path.basename(file)]);
  if (unexpected) {
    return { ...base, status: "no_fixture", reason: `no expected refusal for ${path.basename(unexpected)} in EXPECTED_REFUSALS` };
  }
  const slow = engine.includes("ffmpeg-wasm");
  return {
    ...base,
    driver,
    fixtures: files,
    refusals: refusals.map((file) => ({ fixture: file, ...EXPECTED_REFUSALS[path.basename(file)] })),
    markers,
    pixelCheck: checksPixels(tool.to) && !files.some((file) => ONE_COLOUR_FIXTURES.has(path.basename(file))),
    pages: checksPixels(tool.to) && files.length === 1 ? PAGE_COUNTS[path.basename(files[0])] : undefined,
    tableFile,
    decode: tableFile && DECODED_TABLE_OUTPUTS.has(target),
    compress: tool.operation === "compress" || tool.operation === "bulk",
    timeoutMs: slow ? ffmpegTimeoutMs : timeoutMs,
  };
}

// checkOutputFormat passes any bytes for a format it has no signature for;
// zero bytes match none of the signatures it has.
export function hasSignature(format) {
  return !checkOutputFormat(new ArrayBuffer(16), format).ok;
}

// Image outputs the sweep decodes to catch a blank one: every pixel, or
// nearly, one colour, as the NEF Tools saved before #269 with a valid
// signature. They're decoded in Node by the ImageMagick WASM build the app
// ships, which writes or can read each of them; an SVG is checked through
// the PNG or JPEG it embeds (lib/convert/encode.ts). Not decoded: ICNS, KTX
// and KTX2 (lib/convert/texture-formats.ts writes them; ImageMagick can't
// read them), headerless RGB, EPS (no Ghostscript) and vector SVG.
const PIXEL_FORMATS = {
  avif: "Avif", bmp: "Bmp", cur: "Cur", dds: "Dds", exr: "Exr", gif: "Gif", hdr: "Hdr", ico: "Ico",
  jfif: "Jpeg", jif: "Jpeg", jp2: "Jp2", jpeg: "Jpeg", jpg: "Jpeg", jxl: "Jxl", pam: "Pam", pbm: "Pbm",
  pcd: "Pcd", pcx: "Pcx", pgm: "Pgm", png: "Png", ppm: "Ppm", psd: "Psd", tga: "Tga", tif: "Tiff",
  tiff: "Tiff", wbmp: "Wbmp", webp: "WebP", xbm: "Xbm", xpm: "Xpm",
};

export function checksPixels(format) {
  const name = format?.toLowerCase();
  return name === "svg" || Object.hasOwn(PIXEL_FORMATS, name ?? "");
}

// A pixel within this many levels (of 255) of the top colour in every
// channel counts as that colour, which absorbs a lossy encoder's noise. A
// pixel with alpha under TRANSPARENT counts as transparent, whatever its RGB.
export const PIXEL_TOLERANCE = 8;
const TRANSPARENT = 8;
// An image is blank when its top colour covers at least this share of its
// pixels.
export const BLANK_SHARE = 0.999;

// The colour most of an image's pixels have (within PIXEL_TOLERANCE), and the
// share of pixels that have it. `rgba` is 8-bit RGBA, 4 bytes a pixel.
export function topColour(rgba) {
  const pixels = rgba.length / 4;
  // Channel `offset` of the pixel at byte `index`.
  const channel = (index, offset) => (rgba[index + 3] < TRANSPARENT ? 0 : rgba[index + offset]);
  // The busiest bin of a 4-bit-a-channel histogram, then that bin's mean.
  const binOf = (index) =>
    ((channel(index, 0) >> 4) << 12) |
    ((channel(index, 1) >> 4) << 8) |
    ((channel(index, 2) >> 4) << 4) |
    (channel(index, 3) >> 4);
  const bins = new Uint32Array(1 << 16);
  for (let index = 0; index < rgba.length; index += 4) bins[binOf(index)] += 1;
  let top = 0;
  for (let bin = 1; bin < bins.length; bin += 1) if (bins[bin] > bins[top]) top = bin;
  const sum = [0, 0, 0, 0];
  for (let index = 0; index < rgba.length; index += 4) {
    if (binOf(index) !== top) continue;
    for (let offset = 0; offset < 4; offset += 1) sum[offset] += channel(index, offset);
  }
  const colour = sum.map((total) => Math.round(total / bins[top]));
  let same = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    let near = true;
    for (let offset = 0; offset < 4 && near; offset += 1) {
      near = Math.abs(channel(index, offset) - colour[offset]) <= PIXEL_TOLERANCE;
    }
    if (near) same += 1;
  }
  const hex = colour
    .slice(0, colour[3] === 255 ? 3 : 4)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return { colour: `#${hex.toUpperCase()}`, share: pixels ? same / pixels : 1 };
}

// The PNG or JPEG an SVG wraps as its only content, as encode.ts writes a
// raster image to SVG.
function embeddedRaster(svg) {
  const match = svg.match(
    /^\s*(?:<\?xml[^>]*>\s*)?<svg\b[^>]*>\s*<image\b[^>]*\bhref="data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)"[^>]*\/>\s*<\/svg>\s*$/,
  );
  return match ? { format: match[1], bytes: new Uint8Array(Buffer.from(match[2], "base64")) } : null;
}

// Decodes an image output with ImageMagick (an initialised
// @imagemagick/magick-wasm module) and measures its top colour: for a file
// with several frames (an animation, an icon's sizes), the least uniform
// frame, so it's blank only if every frame is. A PSD is measured by its
// merged image, not its layers. Returns null for a format the sweep doesn't
// decode; throws when ImageMagick can't read the file.
export function measurePixels(magick, bytes, format) {
  const name = format.toLowerCase();
  if (name === "svg") {
    const raster = embeddedRaster(new TextDecoder().decode(bytes));
    return raster ? measurePixels(magick, raster.bytes, raster.format) : null;
  }
  if (!Object.hasOwn(PIXEL_FORMATS, name)) return null;
  return magick.ImageMagick.readCollection(bytes, magick.MagickFormat[PIXEL_FORMATS[name]], (images) => {
    if (!images.length) throw new Error("no image in the file");
    if (images.length > 1 && (name === "gif" || name === "webp")) images.coalesce();
    const frames = name === "psd" ? [images[0]] : [...images];
    const measures = frames.map((image) => {
      const rgba = image.getPixels((pixels) => pixels.toByteArray(0, 0, image.width, image.height, "RGBA"));
      if (!rgba) throw new Error("ImageMagick returned no pixels");
      return { ...topColour(rgba), width: image.width, height: image.height };
    });
    return measures.reduce((least, measure) => (measure.share < least.share ? measure : least));
  });
}

function percent(share) {
  return `${Math.floor(share * 1000) / 10}%`;
}

const WRONG_FORMAT_MESSAGE = /produced \S+ instead of \S+/i;

function toArrayBuffer(head) {
  const bytes = Uint8Array.from(head ?? []);
  return bytes.buffer;
}

function formatName(format) {
  return format === "unknown" ? "unrecognised bytes" : format.toUpperCase();
}

// One run's observation -> { status, error, formatCheck, topColourShare? }.
//   outcome: completed | failed | timeout | error
//   message: what the page showed (or the harness error)
//   errorCode: the tool_run_failed telemetry code, when one was sent
//   outputs: [{ name, size, head: number[] (first bytes), text?, pixels?, decoded? }]
//     pixels: measurePixels' result (null for a format it doesn't decode), or
//     { error } when the image didn't decode
//     decoded: decodeTableOutputs' result, { text } read from the file, or
//     { error } when it didn't open
// A plan with pixelCheck needs every output measured, and one with decode
// every output opened: an output the sweep never read the bytes of fails,
// rather than passing unchecked. One with `pages` (PAGE_COUNTS) needs a file
// for each page.
export function classifyRun(observation, { to, markers = [], pixelCheck = false, decode = false, pages }) {
  const message = observation.message?.trim() || null;
  if (observation.outcome === "timeout") {
    return { status: "timeout", error: message ?? "no result before the timeout" };
  }
  if (observation.outcome === "failed") {
    if (observation.errorCode === "wrong_output_format" || WRONG_FORMAT_MESSAGE.test(message ?? "")) {
      return { status: "wrong_format", error: message ?? "wrong output format", formatCheck: "page" };
    }
    return { status: "error", error: message ?? observation.errorCode ?? "the Tool reported a failure" };
  }
  if (observation.outcome !== "completed") {
    return { status: "error", error: message ?? `harness: unexpected outcome ${observation.outcome}` };
  }

  const outputs = observation.outputs ?? [];
  if (!outputs.length) return { status: "error", error: "finished without saving a file" };
  const empty = outputs.find((output) => !output.size);
  if (empty) return { status: "error", error: `saved an empty file (${empty.name})` };
  if (pages && outputs.length !== pages) {
    return { status: "error", error: `saved ${outputs.length} files for the fixture's ${pages} pages, not one a page` };
  }
  for (const output of outputs) {
    const check = checkOutputFormat(toArrayBuffer(output.head), to);
    if (!check.ok) {
      return {
        status: "wrong_format",
        error: `saved ${formatName(check.detected)} instead of ${formatName(check.expected)} (${output.name})`,
        formatCheck: "signature",
      };
    }
  }
  const formatCheck = decode ? "decoded" : hasSignature(to) ? "signature" : markers.length ? "content" : "none";
  if (decode) {
    const unopened = outputs.find((output) => output.decoded === undefined);
    if (unopened) {
      return {
        status: "error",
        error: `harness: the sweep didn't open the saved file (${unopened.name}), so it couldn't check what it holds`,
        formatCheck,
      };
    }
    const broken = outputs.find((output) => output.decoded.error);
    if (broken) {
      return { status: "error", error: `saved a file that doesn't open (${broken.name}): ${broken.decoded.error}`, formatCheck };
    }
  }
  const missing = markers.filter(
    (marker) => !outputs.some((output) => (decode ? output.decoded.text : output.text)?.includes(marker)),
  );
  if (missing.length) {
    return {
      status: "error",
      error: `the saved file doesn't contain the input's data (missing ${missing.join(", ")})`,
      formatCheck,
    };
  }
  const unread = pixelCheck && outputs.find((output) => output.pixels === undefined);
  if (unread) {
    return {
      status: "error",
      error: `harness: the sweep didn't read the saved image (${unread.name}), so it couldn't check it isn't blank`,
      formatCheck,
    };
  }
  const measured = outputs.filter((output) => output.pixels);
  for (const { name, pixels } of measured) {
    if (pixels.error) {
      return { status: "error", error: `saved an image that doesn't decode (${name}): ${pixels.error}`, formatCheck };
    }
    if (pixels.share >= BLANK_SHARE) {
      return {
        status: "error",
        error: `saved a blank image: ${percent(pixels.share)} of its pixels are ${pixels.colour} (${name})`,
        formatCheck,
      };
    }
  }
  if (!measured.length) return { status: "pass", error: null, formatCheck };
  // How close the least varied output came to blank, for later audits.
  const topColourShare = Math.max(...measured.map(({ pixels }) => Math.floor(pixels.share * 10_000) / 10_000));
  return { status: "pass", error: null, formatCheck, topColourShare };
}

// A run with an input the Tool must refuse (EXPECTED_REFUSALS) -> null when
// the page refused it with the expected message, else what happened
// instead. `expected`: { fixture, errorCode, message }. The telemetry code is
// checked when the page's event was seen.
export function refusalProblem(observation, expected) {
  const shown = observation.message?.trim() || null;
  const want = `a refusal saying "${expected.message}"`;
  if (observation.outcome === "completed") {
    return `expected ${want}, but it converted the file (${observation.outputs?.length ?? 0} saved)`;
  }
  if (observation.outcome === "timeout") return `expected ${want}, but ${shown ?? "nothing happened before the timeout"}`;
  if (observation.outcome !== "failed") return `expected ${want}, but ${shown ?? `the run ended with ${observation.outcome}`}`;
  if (!shown?.includes(expected.message)) return `expected ${want}, but it failed with: ${shown ?? "no message"}`;
  if (observation.errorCode && observation.errorCode !== expected.errorCode) {
    return `expected ${want} (${expected.errorCode}), but its telemetry code was ${observation.errorCode}`;
  }
  return null;
}

// A run's verdict with its refusal runs: each refusal's fixture and message,
// or what went wrong. A Tool that converts its fixture but doesn't refuse
// an input it must fails as an error; any other verdict stands.
export function withRefusals(verdict, refusals) {
  if (!refusals.length) return verdict;
  const recorded = refusals.map(({ fixture, problem, message }) => ({
    fixture: path.basename(fixture),
    ...(problem ? { problem } : { message }),
  }));
  const failed = recorded.find((refusal) => refusal.problem);
  if (verdict.status === "pass" && failed) {
    return { ...verdict, status: "error", error: `${failed.fixture}: ${failed.problem}`, topColourShare: undefined, refusals: recorded };
  }
  return { ...verdict, refusals: recorded };
}

// Opens a table output the way a visitor's app would, and returns the text it
// holds: an XLSX's cells (a ZIP with a workbook and a worksheet), a PDF's
// text (pdf.js, at least one page), an Avro container's records, or a
// Protobuf Table's rows, decoded with the .proto the page saved beside it.
// Throws when the file doesn't open.
export async function decodeTableOutput(format, bytes, { schema = null } = {}) {
  const data = new Uint8Array(bytes);
  if (format === "excel") {
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(data);
    const sheets = Object.keys(files).filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name));
    if (!files["xl/workbook.xml"] || !sheets.length) throw new Error("no workbook or worksheet in the ZIP");
    const xml = [files["xl/sharedStrings.xml"], ...sheets.map((name) => files[name])].filter(Boolean).map(strFromU8);
    const entities = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
    const values = xml.flatMap((part) =>
      [...part.matchAll(/<(?:t|v)(?:\s[^>]*)?>([^<]*)<\/(?:t|v)>/g)].map((match) =>
        match[1].replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => entities[name]),
      ),
    );
    return { text: values.join("\n") };
  }
  if (format === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data, verbosity: 0 });
    try {
      const doc = await task.promise;
      if (!doc.numPages) throw new Error("the PDF has no pages");
      const pages = [];
      for (let number = 1; number <= Math.min(doc.numPages, 20); number += 1) {
        const content = await (await doc.getPage(number)).getTextContent();
        pages.push(content.items.map((item) => item.str).join(" "));
      }
      return { text: pages.join("\n") };
    } finally {
      await task.destroy();
    }
  }
  if (format === "avro") {
    const avro = (await import("avsc")).default;
    const records = await new Promise((resolve, reject) => {
      const decoder = new avro.streams.BlockDecoder();
      const rows = [];
      decoder.on("data", (record) => rows.push(record));
      decoder.on("end", () => resolve(rows));
      decoder.on("error", reject);
      decoder.end(Buffer.from(data));
    });
    if (!records.length) throw new Error("the Avro file holds no records");
    return { text: JSON.stringify(records) };
  }
  if (format === "protobuf") {
    if (!schema) throw new Error("no .proto was saved with the .pb");
    const protobuf = (await import("protobufjs")).default;
    const Table = protobuf.parse(schema, { keepCase: true }).root.lookupType("Table");
    const { rows = [] } = Table.toObject(Table.decode(data));
    if (!rows.length) throw new Error("the Table message holds no rows");
    return { text: JSON.stringify(rows) };
  }
  throw new Error(`no decoder for ${format}`);
}

// Opens each saved table file (decodeTableOutput) and records what it holds
// as output.decoded. A Protobuf run saves two files: the .pb, decoded with
// the .proto beside it, and the .proto, which is read by that decoding.
// `outputs` carry each file's bytes as base64.
export async function decodeTableOutputs(outputs, format) {
  const files = outputs.map((output) => ({ output, bytes: Buffer.from(output.base64 ?? "", "base64") }));
  const proto = files.find(({ output }) => output.name.endsWith(".proto"));
  const schema = proto ? proto.bytes.toString("utf8") : null;
  for (const { output, bytes } of files) {
    if (output === proto?.output) continue;
    try {
      output.decoded = await decodeTableOutput(format, bytes, { schema });
    } catch (error) {
      output.decoded = { error: String(error?.message ?? error).split("\n")[0] };
    }
  }
  if (proto) proto.output.decoded = { text: schema };
}

// A text driver that waited for the fixture's data and gave up: an output
// that holds something else is the Tool's failure; no output is a timeout.
export function textOutputTimeout(output, { markers, timeoutMs }) {
  return output.trim()
    ? { outcome: "failed", message: `the output never showed the input's data (${markers.join(", ")})` }
    : { outcome: "timeout", message: `no output after ${timeoutMs / 1000} s` };
}

// The error a run records when its driver threw. "harness:" marks the
// harness's own failure, which --resume runs again. A crashed tab, or a page
// that never hydrated after a script error, is the Tool's failure: a
// visitor's page would be stuck too.
export function thrownError({ message, step = null, hydration = false, crashed = false, pageError = null }) {
  let error;
  if (crashed) error = "the tab crashed";
  else if (hydration && pageError) error = `the ${step} never became interactive`;
  else error = `harness: ${step ? `${step}: ` : ""}${message.split("\n")[0]}`;
  return pageError ? `${error} (page error: ${pageError})` : error;
}

// Whether the working tree differs from HEAD anywhere but the results file
// (or its temporary copy). Takes `git status --porcelain -z` output, whose
// paths are relative to the repository root, and the results file's path.
export function treeIsDirty(porcelain, resultsPath) {
  const own = new Set([resultsPath, `${resultsPath}.tmp`]);
  const entries = porcelain.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const status = entries[index].slice(0, 2);
    const paths = [entries[index].slice(3)];
    // A rename or copy is followed by the path it came from.
    if (/[RC]/.test(status)) paths.push(entries[(index += 1)]);
    if (paths.some((file) => !own.has(file))) return true;
  }
  return false;
}

// The line in FFmpeg's log that says why it stopped; the page only shows the
// exit code. The first message after "Stream mapping:" names the encoder or
// muxer that refused; without a mapping, the last message before the end says
// what was wrong with the input or the output file. Stream, metadata and
// progress lines describe the files and say nothing about the failure.
const FFMPEG_CONTEXT =
  /^(Stream #|Input #|Output #|Duration:|Metadata:|Side data:|Chapters?:|Press \[q\]|frame=|size=|cpb:|\w+\s+:\s)/;
export function ffmpegError(log) {
  const lines = log.map((line) => line.trim()).filter(Boolean);
  let end = lines.indexOf("Conversion failed!");
  if (end === -1) end = lines.indexOf("Aborted()");
  if (end === -1) end = lines.length;
  const mapping = lines.lastIndexOf("Stream mapping:", end);
  const messages = (from) => lines.slice(from, end).filter((line) => !FFMPEG_CONTEXT.test(line));
  const reason = mapping === -1 ? messages(0).at(-1) : messages(mapping + 1)[0];
  return reason?.replace(/ @ 0x[0-9a-f]+\]/i, "]");
}

// The runnable plans this run measures: all of them, or with --resume only
// those without a measured row, rows whose status --retry names, and rows
// where the harness, not the Tool, failed.
export function selectRuns(plans, previousRows, { resume, retry = new Set(), limit = null }) {
  const previous = new Map(previousRows.map((row) => [row.id, row]));
  const selected = plans.filter((plan) => {
    if (!resume) return true;
    const row = previous.get(plan.id);
    return (
      !row ||
      !MEASURED_STATUSES.has(row.status) ||
      retry.has(row.status) ||
      Boolean(row.error?.startsWith("harness:"))
    );
  });
  return limit ? selected.slice(0, limit) : selected;
}

// One results row: what the plan says about the Tool, what the run observed,
// and the commit and tree state (dirty: uncommitted changes outside the
// results file; null outside a git checkout) it was measured at.
// topColourShare is set on a pass whose image outputs were decoded: the
// largest share of an output's pixels that its top colour covers.
export function sweepRow(plan, result, { commit, dirty }) {
  return {
    id: plan.id,
    route: plan.route,
    from: plan.from,
    to: plan.to,
    handler: plan.handler,
    engine: plan.engine,
    status: result.status,
    durationMs: result.durationMs,
    error: result.error ?? undefined,
    detail: result.detail,
    formatCheck: result.formatCheck,
    topColourShare: result.topColourShare,
    refusals: result.refusals,
    fixture: plan.fixtures?.map((file) => path.basename(file)).join(","),
    output: result.output,
    blocked: result.blocked?.length ? result.blocked : undefined,
    reason: plan.reason,
    commit,
    dirty,
  };
}

// Rows from this run replace earlier rows for the same Tool; rows for Tools
// this run didn't touch are kept. Order follows the registry; rows for Tools
// that are no longer active are dropped.
export function mergeRows(activeIds, previousRows, newRows) {
  const byId = new Map(previousRows.map((row) => [row.id, row]));
  for (const row of newRows) byId.set(row.id, row);
  return activeIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
}

// One row per line, so a re-run diffs per Tool.
export function serializeResults({ meta, results }) {
  const metaJson = JSON.stringify(meta, null, 2).replace(/\n/g, "\n  ");
  const rows = results.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  return `{\n  "meta": ${metaJson},\n  "results": [\n${rows}\n  ]\n}\n`;
}

export function countStatuses(rows) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

const FAILING = ["wrong_format", "error", "timeout"];

function countBy(rows, key) {
  const table = new Map();
  for (const row of rows) {
    const name = key(row) ?? "(none)";
    const counts = table.get(name) ?? Object.fromEntries(FAILING.map((status) => [status, 0]));
    counts[row.status] += 1;
    table.set(name, counts);
  }
  return [...table.entries()].sort(
    ([nameA, a], [nameB, b]) => total(b) - total(a) || nameA.localeCompare(nameB),
  );
}

function total(counts) {
  return FAILING.reduce((sum, status) => sum + counts[status], 0);
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function table(header, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ].join("\n");
}

function failureText(row) {
  const error = (row.error ?? "").replace(/\s+/g, " ");
  return `${row.status}: ${error}${row.detail ? ` [${row.detail.replace(/\s+/g, " ")}]` : ""}`;
}

function idList(title, rows) {
  if (!rows.length) return null;
  const items = rows.map((row) => `- \`${row.id}\`: ${failureText(row).replace(/^\S+: /, "")}`);
  return `<details><summary>${title} (${rows.length})</summary>\n\n${items.join("\n")}\n\n</details>`;
}

// The Markdown summary for a PR or an issue comment.
export function renderSummary({ meta, results }, { activeCount = results.length } = {}) {
  const counts = countStatuses(results);
  const passes = results.filter((row) => row.status === "pass");
  const checks = { signature: 0, content: 0, none: 0 };
  for (const row of passes) checks[row.formatCheck] = (checks[row.formatCheck] ?? 0) + 1;
  const failing = results.filter((row) => FAILING.includes(row.status));
  const lines = [];

  const run = meta.runs?.at(-1);
  const wallMs = (meta.runs ?? []).reduce((sum, entry) => sum + (entry.wallMs ?? 0), 0);
  lines.push(
    `Measured commit \`${String(meta.commit).slice(0, 7)}\` on a local \`wrangler dev\` Worker` +
      (run ? `, concurrency ${run.concurrency}, ${formatDuration(wallMs)} in ${meta.runs.length} session(s).` : "."),
  );
  lines.push("");
  lines.push(
    table(
      ["Status", "Tools"],
      [
        [
          "pass",
          `${counts.pass} (file signature checked: ${checks.signature}, text content checked: ${checks.content}, no check for the output format: ${checks.none}; image decoded and not blank: ${passes.filter((row) => row.topColourShare !== undefined).length})`,
        ],
        ...STATUSES.slice(1).map((status) => [status, String(counts[status])]),
        ["**run / active**", `${results.filter((row) => MEASURED_STATUSES.has(row.status)).length} / ${activeCount}`],
      ],
    ),
  );

  if (failing.length) {
    // Long tables are collapsed so the counts above stay readable in a PR.
    const failingTable = (title, key) => {
      const rows = countBy(failing, key).map(([name, row]) => [name, ...FAILING.map((status) => String(row[status]))]);
      const body = table(["", ...FAILING], rows);
      return rows.length > 15
        ? `<details><summary>${title} (${rows.length})</summary>\n\n${body}\n\n</details>`
        : `${title}\n\n${body}`;
    };
    lines.push("", failingTable("Non-passing Tools by engine", (row) => row.engine));
    lines.push("", failingTable("Non-passing Tools by input format", (row) => row.from));

    // Clustered without the saved file's name, which differs per Tool.
    const messages = new Map();
    for (const row of failing) {
      const message = failureText(row).replace(/ \([^()]+\.[a-z0-9]+\)$/i, "");
      messages.set(message, (messages.get(message) ?? 0) + 1);
    }
    const top = [...messages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    lines.push(
      "",
      "Most common failures (FFmpeg's own reason in brackets):",
      "",
      table(["Failure", "Tools"], top.map(([text, n]) => [text.replace(/\|/g, "\\|"), String(n)])),
    );
  }

  const reasons = new Map();
  const missingFixtures = new Map();
  for (const row of results) {
    if (row.status === "skipped") reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
    if (row.status === "no_fixture") missingFixtures.set(row.from, (missingFixtures.get(row.from) ?? 0) + 1);
  }
  if (missingFixtures.size) {
    const formats = [...missingFixtures.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    reasons.set(
      `no fixture for the input format: ${formats.map(([format, n]) => `${format} ${n}`).join(", ")}`,
      counts.no_fixture,
    );
  }
  if (reasons.size) {
    const rows = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => [reason, String(n)]);
    lines.push("", "Not run:", "", table(["Reason", "Tools"], rows));
  }

  for (const status of FAILING) {
    const list = idList(`${status} Tool ids`, results.filter((row) => row.status === status));
    if (list) lines.push("", list);
  }
  return `${lines.join("\n")}\n`;
}

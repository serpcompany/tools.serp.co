import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLANK_SHARE,
  checksPixels,
  classifyRun,
  converterEngine,
  countStatuses,
  decodeFontOutput,
  decodeOutputs,
  decodeTableOutput,
  EXPECTED_REFUSALS,
  ffmpegError,
  hasSignature,
  loadFixtures,
  measurePixels,
  mergeRows,
  ONE_COLOUR_FIXTURES,
  PAGE_COUNTS,
  pageComponent,
  parseArgs,
  planTool,
  refusalProblem,
  renderSummary,
  scanPageHandlers,
  selectRuns,
  serializeResults,
  textOutputTimeout,
  thrownError,
  topColour,
  treeIsDirty,
  withRefusals,
} from "../scripts/lib/tool-sweep.mjs";
import { writeTableOutput } from "./convert/table-outputs.ts";

// The ImageMagick WASM build the app ships, which the sweep decodes image
// outputs with.
const magick = await import("@imagemagick/magick-wasm");
await magick.initializeImageMagick(
  readFileSync(createRequire(import.meta.url).resolve("@imagemagick/magick-wasm/magick.wasm")),
);

const benchmarksDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../benchmarks");
const fixturesDir = path.join(benchmarksDir, "fixtures");
const head = (name) => Array.from(readFileSync(path.join(fixturesDir, name)).subarray(0, 1024));
const output = (name, extra = {}) => ({ name, size: 100, head: head(name), ...extra });

test("a saved file with the promised signature passes, and says it was checked", () => {
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [output("sample.jpg")] }, { to: "jpg" }), {
    status: "pass",
    error: null,
    formatCheck: "signature",
  });
});

test("PNG bytes saved as a GIF are a wrong format, named after the file", () => {
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [output("sample.png")] }, { to: "gif" }), {
    status: "wrong_format",
    error: "saved PNG instead of GIF (sample.png)",
    formatCheck: "signature",
  });
});

test("every page of a multi-file output is checked", () => {
  const result = classifyRun(
    { outcome: "completed", outputs: [output("sample.jpg"), { name: "page2.jpg", size: 9, head: [1, 2, 3] }] },
    { to: "jpg" },
  );
  assert.equal(result.status, "wrong_format");
  assert.equal(result.error, "saved unrecognised bytes instead of JPG (page2.jpg)");
});

test("the page's own wrong-format refusal is a wrong format, not an error", () => {
  const byCode = classifyRun(
    { outcome: "failed", message: "Something odd", errorCode: "wrong_output_format" },
    { to: "bmp" },
  );
  assert.equal(byCode.status, "wrong_format");
  const byMessage = classifyRun(
    { outcome: "failed", message: "The converter produced PNG instead of BMP." },
    { to: "bmp" },
  );
  assert.deepEqual(byMessage, {
    status: "wrong_format",
    error: "The converter produced PNG instead of BMP.",
    formatCheck: "page",
  });
});

test("a failure keeps the message the page showed", () => {
  assert.deepEqual(
    classifyRun({ outcome: "failed", message: " Image decode failed. ", errorCode: "convert_failed" }, { to: "jpg" }),
    { status: "error", error: "Image decode failed." },
  );
  assert.deepEqual(classifyRun({ outcome: "failed", errorCode: "convert_failed" }, { to: "jpg" }), {
    status: "error",
    error: "convert_failed",
  });
});

test("a multi-page fixture must give one image a page", () => {
  const run = (count) =>
    classifyRun(
      { outcome: "completed", outputs: Array.from({ length: count }, (_, i) => output("sample.jpg", { name: `s_page${i + 1}.jpeg` })) },
      { to: "jpeg", pages: 3 },
    );
  assert.equal(run(3).status, "pass");
  assert.deepEqual(run(1), { status: "error", error: "saved 1 files for the fixture's 3 pages, not one a page" });
  assert.equal(run(4).error, "saved 4 files for the fixture's 3 pages, not one a page");
  assert.equal(PAGE_COUNTS["sample-pages.docx"], 3);
});

test("finishing without a file, or with an empty one, is an error", () => {
  assert.equal(classifyRun({ outcome: "completed", outputs: [] }, { to: "png" }).error, "finished without saving a file");
  assert.equal(
    classifyRun({ outcome: "completed", outputs: [{ name: "a_compressed.mp3", size: 0, head: [] }] }, { to: "mp3" })
      .error,
    "saved an empty file (a_compressed.mp3)",
  );
});

test("timeouts and harness errors keep their own status", () => {
  assert.deepEqual(classifyRun({ outcome: "timeout", message: "no result after 60 s" }, { to: "mp4" }), {
    status: "timeout",
    error: "no result after 60 s",
  });
  assert.equal(classifyRun({ outcome: "error", message: "harness: x" }, { to: "mp4" }).status, "error");
});

test("a text output that fills without the fixture's data is a failure, not a timeout", () => {
  const options = { markers: ["Alpha", "Gamma"], timeoutMs: 60_000 };
  const stale = textOutputTimeout("id,name\n1,Sample row", options);
  assert.deepEqual(stale, { outcome: "failed", message: "the output never showed the input's data (Alpha, Gamma)" });
  assert.equal(classifyRun(stale, { to: "csv", markers: options.markers }).status, "error");
  assert.deepEqual(textOutputTimeout(" \n", options), { outcome: "timeout", message: "no output after 60 s" });
});

test("a run that threw is the harness's failure unless the page is to blame", () => {
  const timeout = "Timeout 20000ms exceeded.\n=========================== logs ===========================";
  assert.equal(
    thrownError({ message: timeout, step: "file input", hydration: true }),
    "harness: file input: Timeout 20000ms exceeded.",
  );
  // A page that never hydrated after a script error is stuck for a visitor too.
  const unhydrated = thrownError({ message: timeout, step: "file input", hydration: true, pageError: "x is not a function" });
  assert.equal(unhydrated, "the file input never became interactive (page error: x is not a function)");
  assert.deepEqual(
    selectRuns([{ id: "a" }], [{ id: "a", status: "error", error: unhydrated }], { resume: true }),
    [],
    "--resume keeps it as a measurement",
  );
  assert.equal(
    thrownError({ message: timeout, step: "upload", pageError: "x is not a function" }),
    "harness: upload: Timeout 20000ms exceeded. (page error: x is not a function)",
  );
  assert.equal(
    thrownError({ message: "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8811/a/\nCall log:" }),
    "harness: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8811/a/",
  );
  assert.equal(
    thrownError({ message: "Target crashed", step: "file input", hydration: true, crashed: true, pageError: "oom" }),
    "the tab crashed (page error: oom)",
  );
});

test("the tree is dirty when any path but the results file differs", () => {
  const results = "apps/tools/benchmarks/tool-sweep-results.json";
  const status = (...entries) => entries.map((entry) => `${entry}\0`).join("");
  assert.equal(treeIsDirty("", results), false);
  assert.equal(treeIsDirty(status(` M ${results}`, `?? ${results}.tmp`), results), false);
  assert.equal(treeIsDirty(status(` M ${results}`, " M apps/tools/scripts/tool-sweep.mjs"), results), true);
  // Exactly that path: a file whose path ends the same way is another file.
  assert.equal(treeIsDirty(status("?? results.json"), results), true);
  assert.equal(treeIsDirty(status(" M benchmarks/tool-sweep-results.json"), results), true);
  // A rename names the old path in the next entry.
  assert.equal(treeIsDirty(status(`R  ${results}`, "apps/tools/benchmarks/old.json"), results), true);
});

// Extensions for the same format. Any other two ready formats with the same
// bytes mean one fixture is a stand-in, and its Tools are fed the wrong input.
const FIXTURE_ALIASES = [
  // BIN to JPG and PNG read a binary file that holds an image, so the BIN
  // fixture is a JPEG (#261).
  ["jpg", "jpeg", "jfif", "bin"],
  ["tif", "tiff"],
  ["aif", "aiff"],
  ["mov", "qt"],
  // An unprotected M4P is an M4A (#261).
  ["m4a", "m4b", "m4p"],
  ["heic", "heif"],
  ["mpeg", "mpg"],
  // The table page's Excel input reads .xlsx files.
  ["xlsx", "excel"],
];

test("two ready formats share a fixture's bytes only if they're aliases", () => {
  const aliasOf = new Map(FIXTURE_ALIASES.flatMap((group) => group.map((format) => [format, group[0]])));
  const byBytes = new Map();
  for (const [format, file] of loadFixtures(benchmarksDir).byFormat) {
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    byBytes.set(hash, [...(byBytes.get(hash) ?? []), format]);
  }
  const shared = [...byBytes.values()].filter(
    (formats) => new Set(formats.map((format) => aliasOf.get(format) ?? format)).size > 1,
  );
  assert.deepEqual(shared, []);
});

test("an output format without a signature passes unchecked, unless text markers apply", () => {
  const bytes = { name: "out.tga", size: 10, head: [0, 1, 2], text: "Alpha,1" };
  assert.equal(classifyRun({ outcome: "completed", outputs: [bytes] }, { to: "tga" }).formatCheck, "none");
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [bytes] }, { to: "json", markers: ["Alpha"] }), {
    status: "pass",
    error: null,
    formatCheck: "content",
  });
  const lost = classifyRun({ outcome: "completed", outputs: [bytes] }, { to: "json", markers: ["Alpha", "Gamma"] });
  assert.equal(lost.status, "error");
  assert.match(lost.error, /missing Gamma/);
  // Text the fixture hides (a hidden sheet, row or column) fails the output
  // that holds it.
  const leaked = classifyRun(
    { outcome: "completed", outputs: [{ ...bytes, text: "North,$15,234.50\nHidden row,secret" }] },
    { to: "csv", markers: ["North"], hidden: ["Hidden row", "secret", "Salary"] },
  );
  assert.deepEqual(leaked, { status: "error", error: "the saved file holds what the input hides (Hidden row, secret)", formatCheck: "content" });
});

// A real PNG: `width` x `height` of `background`, with `draw` run on it first.
function png(width, height, background, draw = () => {}) {
  return magick.ImageMagick.read(new magick.MagickColor(background), width, height, (image) => {
    draw(image);
    return image.write(magick.MagickFormat.Png, (data) => data.slice());
  });
}

// Paints a `width` x `height` grey block (black by default) at the top left.
function block(width, height, level = 0) {
  return (image) =>
    image.getPixels((pixels) => {
      for (let y = 0; y < height; y += 1) {
        pixels.setArea(0, y, width, 1, new Uint8Array(width * image.channelCount).fill(level));
      }
    });
}

test("a blank PNG measures as one colour, and a photo doesn't", () => {
  // The all-white image ImageMagick WASM 0.0.37 made of the NEF fixture.
  assert.deepEqual(measurePixels(magick, png(3039, 2014, "#FFFFFF"), "png"), {
    colour: "#FFFFFF",
    share: 1,
    width: 3039,
    height: 2014,
  });
  // The DNG fixture's photo (native read-back: mean 76.5, sd 34.0) as a PNG.
  const photo = magick.ImageMagick.read(readFileSync(path.join(fixturesDir, "sample.dng")), magick.MagickFormat.Dng, (image) =>
    image.write(magick.MagickFormat.Png, (data) => data.slice()),
  );
  const measured = measurePixels(magick, photo, "png");
  assert.deepEqual([measured.width, measured.height], [644, 644]);
  assert.ok(measured.share < 0.5, `the photo's top colour covers ${measured.share}`);
  // A one-colour fixture is a real PNG of one colour too.
  assert.equal(measurePixels(magick, readFileSync(path.join(fixturesDir, "sample.png")), "png").share, 1);
});

test("nearly one colour is blank; a small drawing on a plain background isn't", () => {
  // 25 stray pixels in 60,000.
  const stray = measurePixels(magick, png(300, 200, "#FFFFFF", block(5, 5)), "png");
  assert.ok(stray.share >= BLANK_SHARE && stray.share < 1);
  // A difference within PIXEL_TOLERANCE is the same colour.
  assert.equal(measurePixels(magick, png(300, 200, "#F8F8F8", block(150, 200, 0xfc)), "png").share, 1);
  // 1% of the pixels drawn: a page with a line of text, say.
  const drawn = measurePixels(magick, png(300, 200, "#FFFFFF", block(30, 20)), "png");
  assert.ok(drawn.share < BLANK_SHARE);
  // The noise of a lossy encoder doesn't make a blank image varied.
  const jpeg = magick.ImageMagick.read(new magick.MagickColor("#3366CC"), 300, 200, (image) => {
    image.quality = 30;
    return image.write(magick.MagickFormat.Jpeg, (data) => data.slice());
  });
  assert.ok(measurePixels(magick, jpeg, "jpg").share >= BLANK_SHARE);
});

test("transparent pixels count as one colour, whatever their RGB", () => {
  const rgba = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 3, 10, 20, 30, 255]);
  assert.deepEqual(topColour(rgba), { colour: "#00000000", share: 0.75 });
});

test("an SVG is measured by the raster it wraps, and other formats aren't measured", () => {
  const white = Buffer.from(png(40, 30, "#FFFFFF")).toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><image href="data:image/png;base64,${white}" width="40" height="30" /></svg>`;
  assert.deepEqual(measurePixels(magick, new TextEncoder().encode(svg), "svg"), {
    colour: "#FFFFFF",
    share: 1,
    width: 40,
    height: 30,
  });
  const vector = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
  assert.equal(measurePixels(magick, new TextEncoder().encode(vector), "svg"), null);
  assert.equal(measurePixels(magick, new Uint8Array(16), "icns"), null);
  assert.throws(() => measurePixels(magick, new Uint8Array(64).fill(7), "png"));
  assert.deepEqual(["png", "JPG", "svg", "tga", "xbm", "icns", "ktx", "rgb", "eps", "mp4"].map(checksPixels), [
    true, true, true, true, true, false, false, false, false, false,
  ]);
});

// A fixture in ONE_COLOUR_FIXTURES switches its Tools' blank check off, so
// it must be one colour. Still images are decoded here. Videos (their first
// frame, `ffmpeg -frames:v 1`), PDF and AI (rendered by macOS `sips`) can't
// be decoded in Node, so each is pinned by the start of its SHA-256, taken
// when it was last read back as one colour. A replaced file fails here until
// it's read back again and its hash updated, or it's taken off the list.
const ONE_COLOUR_PINNED = {
  "sample.ai": "8dce8dea347f1f76", "sample.pdf": "31158c227972d9f8", "sample.3gp": "8ec96c8d49420884",
  "sample.asf": "a6236a221c720be8", "sample.av1": "6bbdc1e92480a78d", "sample.avchd": "49ab202279bce962",
  "sample.avi": "d31dfa2defb637cd", "sample.divx": "4f7157fe1c8d825c", "sample.f4v": "fb1e589941fa9ee2",
  "sample.flv": "8046843cd3092f5a", "sample.hevc": "0bd85ad2602a6a5d", "sample.m2ts": "d959d9bb96421795",
  "sample.m4v": "ae070ff22272420b", "sample.mkv": "e8ae2671322da8f4", "sample.mov": "8847e70f900e25b0",
  "sample.mp4": "b92d75ca17d1dfc6", "sample.mpeg": "e5417e4e0289721f", "sample.mpeg2": "95fe7024a2d4425c",
  "sample.mpg": "e5417e4e0289721f", "sample.mts": "5d75fca0bf476728", "sample.mxf": "b9d1e4794942d5a5",
  "sample.ogv": "e842e3289dcfa066", "sample.rm": "3dff70fcf0cd760b", "sample.swf": "aedcf460a80047f9",
  "sample.ts": "8b86ba801d889855", "sample.vob": "96ccc44081483b98", "sample.webm": "dd3486db3b6de909",
  "sample.wmv": "3d5909f2d398462e",
};

test("every fixture listed as one colour is one colour", () => {
  // ImageMagick can't tell these formats from their first bytes.
  const formats = { cur: magick.MagickFormat.Cur, ico: magick.MagickFormat.Ico, tga: magick.MagickFormat.Tga };
  // The share of each frame, as shown, that its top colour covers.
  const shares = (images) => {
    images.coalesce();
    return [...images].map(
      (image) => topColour(image.getPixels((pixels) => pixels.toByteArray(0, 0, image.width, image.height, "RGBA"))).share,
    );
  };
  for (const name of ONE_COLOUR_FIXTURES) {
    const bytes = readFileSync(path.join(fixturesDir, name));
    if (Object.hasOwn(ONE_COLOUR_PINNED, name)) {
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      assert.equal(hash, ONE_COLOUR_PINNED[name], `${name} has changed: read it back, then update its hash or unlist it`);
      continue;
    }
    const format = formats[path.extname(name).slice(1)];
    const measured = format
      ? magick.ImageMagick.readCollection(bytes, format, shares)
      : magick.ImageMagick.readCollection(bytes, shares);
    assert.ok(measured.length && measured.every((share) => share === 1), `${name} isn't one colour: ${measured}`);
  }
  for (const name of Object.keys(ONE_COLOUR_PINNED)) assert.ok(ONE_COLOUR_FIXTURES.has(name), `${name} isn't listed`);
});

// Several frames: test files made with native ImageMagick 7.1.2, 64 x 64.
const measureFixture = (name) => measurePixels(magick, readFileSync(path.join(fixturesDir, name)), path.extname(name).slice(1));

test("a file with several frames is blank only if every frame is", () => {
  // `magick -size 64x64 xc:white \( -size 64x64 xc:white -fill black -draw
  // "rectangle 0,0 15,15" \) -set delay 50 -loop 0`: a blank frame, then a
  // drawn one. The least uniform frame decides.
  const drawn = measureFixture("sample-frames-blank-then-drawn.gif");
  assert.equal(drawn.share, 0.9375);
  assert.ok(drawn.share < BLANK_SHARE);
  // `magick -size 64x64 xc:white xc:white -set delay 50 -loop 0`.
  assert.deepEqual(measureFixture("sample-frames-blank.gif"), { colour: "#FFFFFF", share: 1, width: 64, height: 64 });
});

test("GIF and WebP animation frames are measured as shown, not as stored", () => {
  // A white frame, then a frame that stores only an 8 x 8 black square at
  // +28+28. Stored, each frame is one colour; shown, the second is 1.6%
  // black. The GIF: `magick -size 64x64 xc:white \( -size 8x8 xc:black -set
  // page +28+28 \) -set dispose none -set delay 50 -loop 0`. The WebP: two
  // full 64 x 64 frames, which the WebP encoder stores as the change.
  for (const name of ["sample-frames-delta.gif", "sample-frames-delta.webp"]) {
    const stored = magick.ImageMagick.readCollection(readFileSync(path.join(fixturesDir, name)), (images) =>
      images.map((image) => `${image.width}x${image.height}`),
    );
    assert.deepEqual(stored, ["64x64", "8x8"], name);
    assert.deepEqual(measureFixture(name), { colour: "#FFFFFF", share: 1 - 64 / 4096, width: 64, height: 64 }, name);
  }
});

test("a PSD is measured by its merged image, not its layers", () => {
  // The first image written is the merged image, the rest are layers, as
  // `magick <merged> <layer> -depth 8 -compress RLE` writes them. A blank
  // merged image (a drawn layer that's hidden) is blank:
  assert.equal(measureFixture("sample-layers-merged-blank.psd").share, 1);
  // and a drawn merged image over a blank layer isn't.
  assert.equal(measureFixture("sample-layers-merged-drawn.psd").share, 0.5);
});

test("a blank or undecodable image fails; a decoded one passes with its top colour's share", () => {
  const run = (pixels) => classifyRun({ outcome: "completed", outputs: [output("sample.png", { pixels })] }, { to: "png" });
  assert.deepEqual(run({ colour: "#FFFFFF", share: 1, width: 3039, height: 2014 }), {
    status: "error",
    error: "saved a blank image: 100% of its pixels are #FFFFFF (sample.png)",
    formatCheck: "signature",
  });
  assert.match(run({ colour: "#000000", share: 0.9995 }).error, /^saved a blank image: 99.9% of its pixels are #000000/);
  assert.deepEqual(run({ colour: "#282726", share: 0.096874 }), {
    status: "pass",
    error: null,
    formatCheck: "signature",
    topColourShare: 0.0968,
  });
  assert.deepEqual(run({ error: "improper image header" }), {
    status: "error",
    error: "saved an image that doesn't decode (sample.png): improper image header",
    formatCheck: "signature",
  });
  // The format check comes first.
  assert.equal(
    classifyRun({ outcome: "completed", outputs: [output("sample.png", { pixels: { error: "x" } })] }, { to: "gif" }).status,
    "wrong_format",
  );
});

test("a checked image the sweep never read fails, rather than passing unchecked", () => {
  const run = (outputs, plan) => classifyRun({ outcome: "completed", outputs }, { to: "png", ...plan });
  assert.deepEqual(run([output("sample.png", { pixels: { colour: "#282726", share: 0.5 } }), output("sample.png")], { pixelCheck: true }), {
    status: "error",
    error: "harness: the sweep didn't read the saved image (sample.png), so it couldn't check it isn't blank",
    formatCheck: "signature",
  });
  // An output read but in a form measurePixels doesn't decode (a vector SVG) passes.
  assert.deepEqual(run([output("sample.png", { pixels: null })], { pixelCheck: true }), {
    status: "pass",
    error: null,
    formatCheck: "signature",
  });
  // A Tool whose fixture is one colour isn't checked.
  assert.equal(run([output("sample.png")], { pixelCheck: false }).status, "pass");
});

test("hasSignature asks the app's check which formats it can verify", () => {
  for (const format of ["png", "jpg", "gif", "pdf", "mp3", "mp4", "svg", "ico", "ktx2", "av1", "hevc"]) {
    assert.equal(hasSignature(format), true, format);
  }
  for (const format of ["tga", "aac", "csv", "json", "mxf", "markdown"]) {
    assert.equal(hasSignature(format), false, format);
  }
});

test("converterEngine follows workerClient's branch order", () => {
  const engine = (operation, from, to) => converterEngine({ operation, from, to });
  assert.equal(engine("convert", "png", "jpg"), "browser-raster");
  assert.equal(engine("convert", "ai", "png"), "pdfjs");
  assert.equal(engine("convert", "pdf", "jpg"), "pdfjs");
  assert.equal(engine("convert", "dng", "jpg"), "imagemagick-wasm");
  for (const from of ["pam", "pbm", "pgm", "ppm", "pcx", "jxl", "jp2", "xpm", "wpg", "pcd", "mac", "sfw", "exr", "hdr"]) {
    assert.equal(engine("convert", from, "png"), "imagemagick-wasm", from);
  }
  assert.equal(engine("convert", "ttf", "svg"), "imagemagick-wasm");
  assert.equal(engine("convert", "otf", "png"), "imagemagick-wasm");
  assert.equal(engine("convert", "heic", "png"), "heif-decoder");
  assert.equal(engine("convert", "mp4", "mp3"), "ffmpeg-wasm");
  assert.equal(engine("convert", "gif", "mp4"), "ffmpeg-wasm");
  assert.equal(engine("convert", "mp4", "mxf"), "ffmpeg-wasm");
  assert.equal(engine("convert", "mp4", "rm"), "server-video, then ffmpeg-wasm");
  assert.equal(engine("convert", "amr", "ogg"), "server-video, then ffmpeg-wasm");
  assert.equal(engine("convert", "av1", "mxf"), "ffmpeg-wasm + webcodecs");
  assert.equal(engine("convert", "mp4", "av1"), "ffmpeg-wasm + webcodecs");
  assert.equal(engine("convert", "mov", "hevc"), "ffmpeg-wasm + webcodecs");
  assert.equal(engine("convert", "hevc", "mp4"), "ffmpeg-wasm");
  assert.equal(engine("compress", "png", "png"), "jsquash-worker");
  assert.equal(engine("compress", "gif", "gif"), "imagemagick-wasm");
  assert.equal(engine("compress", "svg", "svg"), "svgo");
  assert.equal(engine("convert", "svg", "html"), "image-documents");
  assert.equal(engine("convert", "png", "epub"), "image-documents");
  assert.equal(engine("convert", "png", "ai"), "browser-raster");
  assert.equal(engine("convert", "jpg", "txt"), "tesseract");
  assert.equal(engine("convert", "png", "docx"), "docx");
  assert.equal(engine("convert", "csv", "jpg"), "table-outputs");
  assert.equal(engine("convert", "csv", "png"), "table-outputs");
  assert.equal(engine("convert", "docx", "jpeg"), "docx-preview");
  assert.equal(engine("convert", "docx", "tiff"), "docx-preview");
  assert.equal(engine("convert", "dxf", "png"), "dxf-viewer");
  assert.equal(engine("convert", "html", "svg"), "html-render");
  assert.equal(engine("convert", "html", "webp"), "html-render");
  assert.equal(engine("convert", "txt", "svg"), "text-render");
  assert.equal(engine("convert", "txt", "jpeg"), "text-render");
  assert.equal(engine("convert", "dot", "png"), "viz-js");
  assert.equal(engine("convert", "xlsx", "jpg"), "xlsx-table");
  assert.equal(engine("convert", "pptx", "jpeg"), "pptx-glimpse");
  assert.equal(engine("convert", "ppt", "png"), "browser-raster");
  assert.equal(engine("convert", "txt", "pdf"), "browser-raster");
  assert.equal(engine("convert", "image", "pdf"), "image-pdf");
  assert.equal(engine("convert", "svg", "ttf"), "svg-font");
  assert.equal(engine("convert", "svg", "png"), "browser-raster");
  assert.equal(engine("convert", "png", "pdf"), "browser-raster");
  assert.equal(engine("compress", "heic", "heic"), "server-image-compress");
  assert.equal(engine("compress", "pdf", "pdf"), "server-pdf-compress");
  assert.equal(engine("compress", "mp4", "mp4"), "ffmpeg-wasm");
});

test("pageComponent names the page's first non-section component", () => {
  assert.equal(
    pageComponent('import { FAQSection } from "@/components/sections/FAQSection";\nimport X from "@/components/table-convert/TableConvertLanding";'),
    "TableConvertLanding",
  );
  assert.equal(pageComponent('import { ToolPageRenderer } from "@/components/ToolPageRenderer";'), "ToolPageRenderer");
  assert.equal(pageComponent("export default function Page() {}"), "inline");
});

function appFixture() {
  const appDir = mkdtempSync(path.join(tmpdir(), "tool-sweep-app-"));
  const page = (route, source) => {
    mkdirSync(path.join(appDir, route), { recursive: true });
    writeFileSync(path.join(appDir, route, "page.tsx"), source);
  };
  page("(convert)/csv-to-json", 'import T from "@/components/table-convert/TableConvertLanding";');
  page("(convert)/[tool]", 'import { ToolPageRenderer } from "@/components/ToolPageRenderer";');
  page("mp3-to-transcript", 'import TranscribeTool from "@/components/TranscribeTool";');
  return appDir;
}

test("scanPageHandlers maps routes without groups and leaves dynamic routes out", () => {
  const appDir = appFixture();
  try {
    assert.deepEqual(
      [...scanPageHandlers(appDir).entries()].sort(),
      [
        ["/csv-to-json", "TableConvertLanding"],
        ["/mp3-to-transcript", "TranscribeTool"],
      ],
    );
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test("planTool picks a driver and fixture, or says why a Tool isn't run", () => {
  const handlers = new Map([
    ["/csv-to-json", "TableConvertLanding"],
    ["/mp3-to-transcript", "TranscribeTool"],
  ]);
  const fixtures = {
    byFormat: new Map([
      ["png", "/f/sample.png"],
      ["csv", "/f/sample.csv"],
      ["mp4", "/f/sample.mp4"],
    ]),
    byTool: new Map([["batch-compress-png", ["/f/sample.png", "/f/sample-2.png"]]]),
  };
  const options = { handlers, fixtures, timeoutMs: 60, ffmpegTimeoutMs: 180 };
  const plan = (tool) => planTool({ isActive: true, ...tool }, options);

  const png = plan({ id: "png-to-jpg", route: "/png-to-jpg", operation: "convert", from: "png", to: "jpg" });
  assert.deepEqual(
    [png.handler, png.engine, png.driver, png.fixtures, png.timeoutMs, png.status],
    ["ToolPageRenderer", "browser-raster", "file", ["/f/sample.png"], 60, undefined],
  );
  // sample.png is one colour, so a blank JPG can't be told from a faithful one.
  assert.equal(png.pixelCheck, false);
  const nefOptions = { ...options, fixtures: { ...fixtures, byFormat: new Map([["nef", "/f/sample.nef"]]) } };
  const nef = (to) => planTool({ id: `nef-to-${to}`, route: `/nef-to-${to}`, operation: "convert", from: "nef", to }, nefOptions);
  assert.deepEqual(["png", "svg", "xbm", "pdf"].map((to) => nef(to).pixelCheck), [true, true, true, false]);
  const video = plan({ id: "mp4-to-mp3", route: "/mp4-to-mp3", operation: "convert", from: "mp4", to: "mp3" });
  assert.equal(video.timeoutMs, 180);
  assert.equal(plan({ id: "mp4-to-mxf", route: "/mp4-to-mxf", operation: "convert", from: "mp4", to: "mxf" }).timeoutMs, 180);
  const table = plan({ id: "csv-to-json", route: "/csv-to-json", operation: "convert", from: "csv", to: "json" });
  assert.deepEqual([table.driver, table.markers, table.compress], ["table", ["Alpha"], false]);
  assert.deepEqual([table.tableFile, table.decode], [false, false]);
  // A table written as a file is opened and searched for the fixture's data;
  // a table image can't be searched, so its pixels are checked.
  const tableFile = (to) =>
    planTool(
      { id: `csv-to-${to}`, route: `/csv-to-${to}`, operation: "convert", from: "csv", to },
      { ...options, handlers: new Map([[`/csv-to-${to}`, "TableConvertLanding"]]), fixtures: { ...fixtures, byFormat: new Map([["csv", "/f/sample.csv"]]) } },
    );
  assert.deepEqual(
    ["excel", "pdf", "avro", "protobuf", "png", "jpeg"].map((to) => {
      const { driver, tableFile: file, decode, markers, pixelCheck } = tableFile(to);
      return [to, driver, file, decode, markers, pixelCheck];
    }),
    [
      ["excel", "table", true, true, ["Alpha"], false],
      ["pdf", "table", true, true, ["Alpha"], false],
      ["avro", "table", true, true, ["Alpha"], false],
      ["protobuf", "table", true, true, ["Alpha"], false],
      ["png", "table", true, false, [], true],
      ["jpeg", "table", true, false, [], true],
    ],
  );
  // A DOCX fixture with several pages expects an image of each, but not as one PDF.
  const pagesOptions = {
    ...options,
    fixtures: { ...fixtures, byTool: new Map([["docx-to-jpeg", ["/f/sample-pages.docx"]], ["docx-to-pdf", ["/f/sample-pages.docx"]]]) },
  };
  const docx = (to) => planTool({ id: `docx-to-${to}`, route: `/docx-to-${to}`, operation: "convert", from: "docx", to }, pagesOptions);
  assert.deepEqual([docx("jpeg").engine, docx("jpeg").pages, docx("jpeg").pixelCheck], ["docx-preview", 3, true]);
  assert.equal(docx("pdf").pages, undefined);
  assert.equal(png.pages, undefined);
  const compress = plan({ id: "compress-png", route: "/compress-png", operation: "compress", from: "png", to: "png" });
  assert.equal(compress.compress, true);
  // An Excel input is read by the XLSX reader first: its own engine, its
  // fixture's shown values to find and its hidden ones to miss.
  const excel = planTool(
    { id: "excel-to-csv", route: "/excel-to-csv", operation: "convert", from: "excel", to: "csv" },
    { ...options, handlers: new Map([["/excel-to-csv", "TableConvertLanding"]]), fixtures: { ...fixtures, byFormat: new Map([["excel", "/f/sample-sheets.xlsx"]]) } },
  );
  assert.deepEqual(
    [excel.engine, excel.driver, excel.markers, excel.hidden],
    [
      "table-convert + xlsx",
      "table",
      ["North", "3/14/2026", "1,200", "$15,234.50", "25%", "$67,105.75"],
      ["Hidden row", "secret", "Internal", "cost 9.10", "Hidden sheet", "Salary"],
    ],
  );
  assert.equal(table.hidden, undefined);
  // A text converter whose fixture has no known data marker can't be checked.
  const markerless = planTool(
    { id: "csv-to-xml", route: "/csv-to-xml", operation: "convert", from: "csv", to: "xml" },
    { ...options, handlers: new Map([["/csv-to-xml", "TableConvertLanding"]]), fixtures: { ...fixtures, byFormat: new Map([["csv", "/f/other.csv"]]) } },
  );
  assert.equal(markerless.status, "no_fixture");
  const batch = plan({ id: "batch-compress-png", route: "/batch-compress-png", operation: "bulk", from: "png", to: "png" });
  assert.equal(batch.status, "skipped", "bulk without its own page has no driver");

  assert.deepEqual(
    plan({ id: "icns-to-png", route: "/icns-to-png", operation: "convert", from: "icns", to: "png" }).status,
    "no_fixture",
  );
  const skipped = (tool) => plan(tool).reason;
  assert.match(skipped({ id: "download-x", route: "/download-x", operation: "download" }), /downloader/);
  assert.match(skipped({ id: "mp3-to-transcript", route: "/mp3-to-transcript", operation: "convert", from: "mp3", to: "txt" }), /transcription/);
  assert.match(skipped({ id: "video-editor", route: "/video-editor", operation: "video-editor" }), /placeholder/);
  assert.match(skipped({ id: "pdf-reader", route: "/pdf-reader", operation: "view", from: "pdf", to: "pdf" }), /viewer/);
});

test("a format's refusal fixtures run on its converter pages, each with the message it must show", () => {
  const fixtures = {
    byFormat: new Map([["bin", "/f/sample.bin"], ["csv", "/f/sample.csv"]]),
    byTool: new Map(),
    refusals: new Map([["bin", ["/f/not-an-image.bin"]], ["csv", ["/f/not-an-image.bin"]]]),
  };
  const options = { handlers: new Map([["/csv-to-json", "TableConvertLanding"]]), fixtures, timeoutMs: 60, ffmpegTimeoutMs: 180 };
  const binTool = { id: "bin-to-png", route: "/bin-to-png", operation: "convert", from: "bin", to: "png" };
  const bin = planTool(binTool, options);
  assert.equal(bin.engine, "bin-image");
  assert.deepEqual(bin.refusals, [{ fixture: "/f/not-an-image.bin", errorCode: "not_an_image", message: "isn't an image" }]);
  // Only the generic converter page is driven with one.
  const table = planTool({ id: "csv-to-json", route: "/csv-to-json", operation: "convert", from: "csv", to: "json" }, options);
  assert.deepEqual(table.refusals, []);
  // A refusal with no expected message would prove nothing.
  const unknown = planTool(binTool, { ...options, fixtures: { ...fixtures, refusals: new Map([["bin", ["/f/other.bin"]]]) } });
  assert.equal(unknown.status, "no_fixture");
  assert.match(unknown.reason, /other\.bin in EXPECTED_REFUSALS/);
});

test("every refusal fixture in fixture-matrix.json exists and has its expected message", () => {
  const listed = [...loadFixtures(benchmarksDir).refusals.values()].flat();
  assert.deepEqual(listed.map((file) => path.basename(file)).sort(), Object.keys(EXPECTED_REFUSALS).sort());
  for (const file of listed) assert.ok(readFileSync(file).length > 0, file);
});

test("a refusal passes only with the expected message, and code when the event was seen", () => {
  const expected = { fixture: "/f/tika-drm.m4p", errorCode: "copy_protected", message: "copy-protected" };
  const message = "This M4P file is copy-protected by Apple (FairPlay), so it can't be converted to MP3.";
  assert.equal(refusalProblem({ outcome: "failed", message, errorCode: "copy_protected" }, expected), null);
  assert.equal(refusalProblem({ outcome: "failed", message, errorCode: null }, expected), null);
  assert.equal(
    refusalProblem({ outcome: "completed", outputs: [{ name: "a.mp3" }] }, expected),
    'expected a refusal saying "copy-protected", but it converted the file (1 saved)',
  );
  assert.equal(
    refusalProblem({ outcome: "failed", message: "FFmpeg failed with exit code 1", errorCode: "convert_failed" }, expected),
    'expected a refusal saying "copy-protected", but it failed with: FFmpeg failed with exit code 1',
  );
  assert.match(refusalProblem({ outcome: "failed", message, errorCode: "convert_failed" }, expected), /telemetry code was convert_failed$/);
  assert.match(refusalProblem({ outcome: "timeout", message: "no result after 180 s" }, expected), /, but no result after 180 s$/);
  assert.match(refusalProblem({ outcome: "error", message: "harness: upload: closed" }, expected), /, but harness: upload: closed$/);
});

test("a Tool that converts its fixture but doesn't refuse an input fails, and its refusals are recorded", () => {
  const pass = { status: "pass", error: null, formatCheck: "signature", topColourShare: 0.5 };
  assert.deepEqual(withRefusals(pass, []), pass);
  const message = "This M4P file is copy-protected";
  const refused = [{ fixture: "/f/tika-drm.m4p", errorCode: "copy_protected", message, problem: null }];
  assert.deepEqual(withRefusals(pass, refused), { ...pass, refusals: [{ fixture: "tika-drm.m4p", message }] });
  const problem = 'expected a refusal saying "copy-protected", but it converted the file (1 saved)';
  const converted = [{ fixture: "/f/tika-drm.m4p", errorCode: "copy_protected", message: undefined, problem }];
  const failed = withRefusals(pass, converted);
  assert.deepEqual([failed.status, failed.error, failed.topColourShare], ["error", `tika-drm.m4p: ${problem}`, undefined]);
  assert.deepEqual(failed.refusals, [{ fixture: "tika-drm.m4p", problem }]);
  // Any other verdict stands.
  assert.equal(withRefusals({ status: "timeout", error: "no result" }, converted).error, "no result");
});

test("parseArgs takes defaults, validates numbers and refuses non-local targets", () => {
  const args = parseArgs(["--base-url", "http://localhost:8787/"]);
  assert.deepEqual(
    [args.baseUrl, args.concurrency, args.timeoutMs, args.ffmpegTimeoutMs, args.resume, args.only],
    ["http://localhost:8787", 4, 60_000, 180_000, false, null],
  );
  const custom = parseArgs([
    "--base-url", "http://127.0.0.1:8787", "--concurrency", "8", "--only", "a, b", "--limit", "5",
    "--resume", "--retry", "error,timeout",
  ]);
  assert.deepEqual([custom.concurrency, custom.only, custom.limit, [...custom.retry]], [8, ["a", "b"], 5, ["error", "timeout"]]);
  assert.throws(() => parseArgs([]), /--base-url is required/);
  assert.throws(() => parseArgs(["--base-url", "https://staging.tools.serp.co"]), /local Worker/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--concurrency", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--retry", "error"]), /only applies with --resume/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--resume", "--retry", "skipped"]), /measured statuses/);
  assert.equal(parseArgs(["--summary"]).summary, true);
});

test("parseArgs runs Playwright's Chromium unless --channel names an installed browser", () => {
  assert.equal(parseArgs(["--base-url", "http://localhost:1"]).channel, "chromium");
  assert.equal(parseArgs(["--base-url", "http://localhost:1", "--channel", "chrome"]).channel, "chrome");
  assert.equal(parseArgs(["--base-url", "http://localhost:1", "--channel", "msedge"]).channel, "msedge");
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--channel", "firefox"]), /--channel takes/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--channel"]), /needs a value/);
});

test("a resumed run skips measured Tools, re-runs --retry statuses and unmeasured rows", () => {
  const plans = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  const previous = [
    { id: "a", status: "pass" },
    { id: "b", status: "error" },
    { id: "c", status: "timeout" },
    { id: "d", status: "no_fixture" },
  ];
  const ids = (runs) => runs.map((plan) => plan.id);
  assert.deepEqual(ids(selectRuns(plans, previous, { resume: false })), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids(selectRuns(plans, previous, { resume: true })), ["d", "e"]);
  assert.deepEqual(ids(selectRuns(plans, previous, { resume: true, retry: new Set(["timeout"]) })), ["c", "d", "e"]);
  assert.deepEqual(ids(selectRuns(plans, previous, { resume: true, limit: 1 })), ["d"]);
  // A harness failure was never a measurement of the Tool.
  const harness = [...previous.slice(1), { id: "a", status: "error", error: "harness: file input: Timeout" }];
  assert.deepEqual(ids(selectRuns(plans, harness, { resume: true })), ["a", "d", "e"]);
});

test("new rows replace old ones in registry order, and retired Tools drop out", () => {
  const merged = mergeRows(
    ["a", "b", "c"],
    [
      { id: "c", status: "pass" },
      { id: "a", status: "error" },
      { id: "gone", status: "pass" },
    ],
    [{ id: "a", status: "pass" }, { id: "b", status: "timeout" }],
  );
  assert.deepEqual(merged, [
    { id: "a", status: "pass" },
    { id: "b", status: "timeout" },
    { id: "c", status: "pass" },
  ]);
});

test("results serialize one row per line and parse back unchanged", () => {
  const data = {
    meta: { commit: "abc", runs: [{ concurrency: 4, wallMs: 1 }] },
    results: [
      { id: "a", status: "pass" },
      { id: "b", status: "error", error: "x" },
    ],
  };
  const text = serializeResults(data);
  assert.deepEqual(JSON.parse(text), data);
  assert.ok(text.includes('\n    {"id":"a","status":"pass"},\n    {"id":"b"'));
});

test("ffmpegError names the encoder that refused, not the exit code", () => {
  const log = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':",
    "Stream mapping:",
    "  Stream #0:0 -> #0:0 (h264 (native) -> h263 (native))",
    "[h263 @ 0xdf1b00] The specified picture size of 320x240 is not valid for the H.263 codec.",
    "Error initializing output stream 0:0 -- Error while opening encoder",
    "Conversion failed!",
    "Aborted()",
  ];
  assert.equal(ffmpegError(log), "[h263] The specified picture size of 320x240 is not valid for the H.263 codec.");
  assert.equal(
    ffmpegError(["input.rm: Invalid data found when processing input", "Aborted()"]),
    "input.rm: Invalid data found when processing input",
  );
  // A video without audio converted to MP3: the stream line mentions "unknown".
  assert.equal(
    ffmpegError([
      "Input #0, mjpeg, from 'input.mjpeg':",
      "  Duration: N/A, bitrate: N/A",
      "  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 320x240",
      "Output #0, mp3, to 'output.mp3':",
      "  Metadata:",
      "    encoder         : Lavf59.27.100",
      "Output file #0 does not contain any stream",
      "Aborted()",
    ]),
    "Output file #0 does not contain any stream",
  );
  assert.equal(ffmpegError([]), undefined);
});

test("the summary counts statuses, splits passes by check and lists failing ids", () => {
  const results = [
    { id: "a", from: "png", engine: "browser-raster", status: "pass", formatCheck: "signature", topColourShare: 0.2 },
    { id: "b", from: "png", engine: "browser-raster", status: "pass", formatCheck: "none" },
    { id: "c", from: "mp4", engine: "ffmpeg-wasm", status: "error", error: "FFmpeg failed", detail: "[h263] size" },
    { id: "d", from: "icns", status: "no_fixture" },
    { id: "e", status: "skipped", reason: "downloader: needs a real third-party media URL" },
  ];
  assert.deepEqual(countStatuses(results), {
    pass: 2, wrong_format: 0, error: 1, timeout: 0, no_fixture: 1, skipped: 1,
  });
  const summary = renderSummary(
    { meta: { commit: "0123456789", runs: [{ concurrency: 4, wallMs: 90 * 60_000 }] }, results },
    { activeCount: 6 },
  );
  assert.match(summary, /`0123456`.*concurrency 4, 1 h 30 min/);
  assert.match(
    summary,
    /\| pass \| 2 \(file signature checked: 1, text content checked: 0, no check for the output format: 1; image decoded and not blank: 1\) \|/,
  );
  assert.match(summary, /\| \*\*run \/ active\*\* \| 3 \/ 6 \|/);
  assert.match(summary, /Non-passing Tools by engine\n\n\| +\| wrong_format/);
  assert.match(summary, /\| ffmpeg-wasm \| 0 \| 1 \| 0 \|/);
  assert.match(summary, /error: FFmpeg failed \[\[h263\] size\] \| 1 \|/);
  assert.match(summary, /no fixture for the input format: icns 1 \| 1 \|/);
  assert.match(summary, /<summary>error Tool ids \(1\)<\/summary>\n\n- `c`: FFmpeg failed/);
});

const SWEEP_TABLE = { headers: ["name", "count"], rows: [["Alpha", "1"], ["Beta", "2"]] };
const base64Of = (buffer) => Buffer.from(buffer).toString("base64");

test("each table file the pages write opens, and holds the fixture's data", async () => {
  for (const format of ["excel", "pdf", "avro"]) {
    const { buffer } = await writeTableOutput(format, SWEEP_TABLE);
    const { text } = await decodeTableOutput(format, Buffer.from(buffer));
    assert.ok(text.includes("Alpha") && text.includes("Beta"), `${format}: ${text}`);
  }
  const protobuf = await writeTableOutput("protobuf", SWEEP_TABLE);
  const { text } = await decodeTableOutput("protobuf", Buffer.from(protobuf.buffer), { schema: protobuf.schema });
  assert.equal(text, JSON.stringify([{ name: "Alpha", count: "1" }, { name: "Beta", count: "2" }]));
});

test("a table file that doesn't open, or holds nothing, is caught", async () => {
  const csv = Buffer.from("name,count\nAlpha,1\n");
  for (const format of ["excel", "pdf", "avro"]) {
    await assert.rejects(decodeTableOutput(format, csv), format);
  }
  // A ZIP with a [Content_Types].xml and an xl/ folder but no worksheet.
  const { zipSync, strToU8 } = await import("fflate");
  const hollow = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "xl/workbook.xml": strToU8("<workbook/>") });
  await assert.rejects(decodeTableOutput("excel", Buffer.from(hollow)), /no workbook or worksheet/);
  const empty = await writeTableOutput("avro", { headers: ["name"], rows: [] });
  await assert.rejects(decodeTableOutput("avro", Buffer.from(empty.buffer)), /no records/);
  const protobuf = await writeTableOutput("protobuf", SWEEP_TABLE);
  await assert.rejects(decodeTableOutput("protobuf", Buffer.from(protobuf.buffer)), /no .proto/);
});

test("a Protobuf run's .pb is decoded with the .proto saved beside it", async () => {
  const protobuf = await writeTableOutput("protobuf", SWEEP_TABLE);
  const outputs = [
    { name: "sample.pb", size: protobuf.buffer.byteLength, head: [], base64: base64Of(protobuf.buffer) },
    { name: "sample.proto", size: protobuf.schema.length, head: [], base64: base64Of(Buffer.from(protobuf.schema)) },
  ];
  await decodeOutputs(outputs, "protobuf");
  assert.match(outputs[0].decoded.text, /Alpha/);
  assert.equal(outputs[1].decoded.text, protobuf.schema);
  assert.deepEqual(classifyRun({ outcome: "completed", outputs }, { to: "protobuf", markers: ["Alpha"], decode: true }), {
    status: "pass",
    error: null,
    formatCheck: "decoded",
  });
});

test("a decoded table file passes only when it opens and holds the fixture's data", async () => {
  const { buffer } = await writeTableOutput("excel", SWEEP_TABLE);
  const xlsx = () => ({ name: "sample.xlsx", size: buffer.byteLength, head: Array.from(new Uint8Array(buffer).subarray(0, 1024)) });
  const plan = { to: "excel", markers: ["Alpha"], decode: true };
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [{ ...xlsx(), decoded: { text: "Alpha\n1" } }] }, plan), {
    status: "pass",
    error: null,
    formatCheck: "decoded",
  });
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [{ ...xlsx(), decoded: { text: "Gamma" } }] }, plan), {
    status: "error",
    error: "the saved file doesn't contain the input's data (missing Alpha)",
    formatCheck: "decoded",
  });
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [{ ...xlsx(), decoded: { error: "bad zip" } }] }, plan), {
    status: "error",
    error: "saved a file that doesn't open (sample.xlsx): bad zip",
    formatCheck: "decoded",
  });
  assert.match(classifyRun({ outcome: "completed", outputs: [xlsx()] }, plan).error, /^harness: the sweep didn't open/);
  // The raw bytes holding the marker isn't enough: the file must open.
  assert.equal(
    classifyRun({ outcome: "completed", outputs: [{ ...xlsx(), text: "Alpha", decoded: { error: "bad zip" } }] }, plan).status,
    "error",
  );
});

test("SVG to TTF's font is opened with a font parser, and must have an outlined glyph on U+E000", async () => {
  const fixtures = loadFixtures(benchmarksDir);
  const plan = planTool(
    { id: "svg-to-ttf", route: "/svg-to-ttf", operation: "convert", from: "svg", to: "ttf", isActive: true },
    { handlers: new Map(), fixtures, timeoutMs: 60, ffmpegTimeoutMs: 180 },
  );
  assert.deepEqual(
    [plan.engine, plan.driver, plan.fixtures.map((file) => path.basename(file)), plan.decode, plan.pixelCheck],
    ["svg-font", "file", ["sample-icon.svg"], true, false],
  );
  const { svgToTtf } = await import("./convert/svg-font.ts");
  const icon = readFileSync(plan.fixtures[0]);
  const { buffer } = await svgToTtf(icon.buffer.slice(icon.byteOffset, icon.byteOffset + icon.byteLength), "sample-icon.svg");
  const decoded = await decodeFontOutput(Buffer.from(buffer));
  assert.match(decoded.text, /^sample-icon: U\+E000 has \d+ contours$/);
  // A font without the glyph (the TTF fixture has none there), and bytes
  // that aren't a font.
  await assert.rejects(decodeFontOutput(readFileSync(path.join(fixturesDir, "sample.ttf"))), /no glyph on U\+E000/);
  await assert.rejects(decodeFontOutput(Buffer.from([0, 1, 0, 0, 0, 0])));
  const output = { name: "sample-icon.ttf", size: buffer.byteLength, head: Array.from(new Uint8Array(buffer).subarray(0, 64)), base64: base64Of(buffer) };
  await decodeOutputs([output], "ttf");
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [output] }, plan), { status: "pass", error: null, formatCheck: "decoded" });
  assert.deepEqual(
    classifyRun({ outcome: "completed", outputs: [{ ...output, decoded: { error: "no glyph on U+E000" } }] }, plan),
    { status: "error", error: "saved a file that doesn't open (sample-icon.ttf): no glyph on U+E000", formatCheck: "decoded" },
  );
});

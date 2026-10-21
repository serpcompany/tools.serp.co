// The numbers scripts/lib/engine-facts.mjs tells writers are the engine's own
// (#356): each is read from the constant or builder it cites, so changing an
// engine fails here until its fact is updated. Numbers with no importable
// constant (HeroConverter's 0.82, the 0.85 output quality, ImageMagick's
// 537 megapixels, PDF.js's JPEG 0.9) are listed in PR #364 instead.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ENGINE_FACTS, engineFactsFor } from "../scripts/lib/engine-facts.mjs";
import { splitRegistry } from "../scripts/lib/content.mjs";
import { parseCsv } from "../scripts/lib/csv.mjs";
import {
  mapQualityToAudioBitrate,
  mapQualityToImageQuality,
  mapQualityToPngLevel,
  mapQualityToVideoCrf,
} from "./compression-utils.ts";
import { MAX_VIDEO_FPS, MAX_VIDEO_SIZE, VIDEO_FILTER, buildCompressionCommand, buildConvertCommand } from "./convert/ffmpeg-args.ts";
import { MAX_PAGE_SIDE, PHOTO_QUALITY } from "./convert/image-pdf.ts";
import { IMAGE_PDF_INPUTS, IMAGE_PDF_MAX_BYTES, IMAGE_PDF_MAX_IMAGES, IMAGE_PDF_MAX_PIXELS } from "./convert/image-pdf-inputs.ts";
import { MAX_RENDER_PIXELS } from "./convert/pdf.ts";
import { SERVER_ACTION_RATE_LIMIT_WINDOW_MS } from "./server-action-contract.js";


// Facts that depend on the Tool (target format, source format, the command):
// read through engineFactsFor with the registry's Tool and its engine.
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = new Map(
  splitRegistry(readFileSync(path.join(appRoot, "lib/catalog/tools.json"), "utf8")).map((entry) => JSON.parse(entry)).map((tool) => [tool.id, tool]),
);
const engines = new Map(
  parseCsv(readFileSync(path.join(appRoot, "benchmarks/tool-status.csv"), "utf8")).filter((row) => row.tool_id).map((row) => [row.tool_id, row.engine]),
);

// The compressor's quality (components/HeroConverter.tsx), as the facts state it.
const COMPRESS_QUALITY = 0.82;

const text = (engine) => {
  const entry = ENGINE_FACTS[engine];
  return [entry.where, ...(entry.facts ?? []), ...(entry.convert ?? []), ...(entry.compress ?? [])].join("\n");
};
const flags = (args) => args.join(" ");

test("the FFmpeg facts are the command builders' and the size limits' numbers", () => {
  const ffmpeg = text("ffmpeg-wasm");
  assert.match(
    factsOf("avi-to-mp4").text,
    new RegExp(`up to ${MAX_VIDEO_SIZE} px on the longer side and ${MAX_VIDEO_FPS} fps`),
  );

  const gif = flags(buildConvertCommand("mp4", "gif").args);
  const [, gifFps] = gif.match(/fps=(\d+)/);
  assert.match(ffmpeg, new RegExp(`Video to GIF: ${gifFps} fps, at most 480 px`));
  assert.match(gif, /480/);

  const bitrate = mapQualityToAudioBitrate(COMPRESS_QUALITY);
  assert.match(ffmpeg, new RegExp(`Audio is re-encoded at ${bitrate.replace("k", "")} kbit/s`));
  assert.match(flags(buildCompressionCommand("mp3", COMPRESS_QUALITY).args), new RegExp(`-b:a ${bitrate}`));

  const crf = mapQualityToVideoCrf(COMPRESS_QUALITY);
  const mp4 = flags(buildCompressionCommand("mp4", COMPRESS_QUALITY).args);
  assert.match(mp4, new RegExp(`-crf ${crf}\\b`));
  assert.match(mp4, /-preset medium/);
  assert.match(ffmpeg, new RegExp(`libx264 \\(preset medium, CRF ${crf}\\)`));

  const webm = flags(buildCompressionCommand("webm", COMPRESS_QUALITY).args);
  const [, vp8Crf] = webm.match(/-crf (\d+)/);
  assert.match(webm, /libvpx\b/);
  assert.match(ffmpeg, new RegExp(`WebM with VP8 \\(CRF ${vp8Crf}\\)`));
  assert.match(ffmpeg, new RegExp(`at quality ${COMPRESS_QUALITY}`));
});

test("the PNG compressor states its lossy main-thread fallback", () => {
  // qualityToColorCount in lib/convert/workerClient.ts: round(quality * 256), at least 16.
  const colours = Math.max(16, Math.round(COMPRESS_QUALITY * 256));
  const { text: png } = factsOf("png-to-png");
  assert.match(png, /oxipng at level 1, which is lossless/);
  assert.match(png, new RegExp(`falls back to the main thread .*compressPngOnMainThread.*at most ${colours} colours, which is lossy, and keeps only the first frame`));
});

test("the image compressor facts are the quality mappings' numbers", () => {
  const quality = mapQualityToImageQuality(COMPRESS_QUALITY);
  assert.match(text("jsquash-worker"), new RegExp(`re-encoded at quality ${quality};`));
  assert.match(text("jsquash-worker"), new RegExp(`oxipng at level ${mapQualityToPngLevel(COMPRESS_QUALITY)}`));
  // compressImageWithMagick sets AVIF to Math.round(quality * 100).
  assert.match(text("imagemagick-wasm"), new RegExp(`AVIF: quality ${Math.round(COMPRESS_QUALITY * 100)}`));
});

test("the PDF and image-to-PDF limits are their constants", () => {
  // The cap is on area (pageRenderScale), so the fact gives pixels, not sides.
  assert.match(text("pdfjs"), new RegExp(`within ${MAX_RENDER_PIXELS.toLocaleString("en-US")} pixels, about ${(MAX_RENDER_PIXELS / 1e6).toFixed(1)} megapixels`));
  assert.match(text("pdfjs"), /scale at most 2/);
  assert.doesNotMatch(text("pdfjs"), /4096 × 4096/);

  const imagePdf = text("image-pdf");
  assert.match(
    imagePdf,
    new RegExp(
      `Limits: ${IMAGE_PDF_MAX_IMAGES} images, ${IMAGE_PDF_MAX_BYTES / 1024 / 1024} MB in all, ${IMAGE_PDF_MAX_PIXELS / 1_000_000} megapixels per image`,
    ),
  );
  assert.match(imagePdf, new RegExp(`a side over ${MAX_PAGE_SIDE.toLocaleString("en-US")} points \\(${MAX_PAGE_SIDE / 72} inches`));
  assert.match(imagePdf, new RegExp(`as a JPEG at quality ${Math.round(PHOTO_QUALITY * 100)} `));
  for (const format of ["jpg", "png", "gif", "webp", "bmp", "avif", "ico", "svg", "heic", "heif", "tiff", "psd", "dng"]) {
    assert.ok(IMAGE_PDF_INPUTS.includes(format), `the facts say Image to PDF reads ${format}`);
  }
});

test("the server's wait between conversions is the server-action cooldown", () => {
  assert.match(
    text("server-video, then ffmpeg-wasm"),
    new RegExp(`waits ${SERVER_ACTION_RATE_LIMIT_WINDOW_MS / 1000} s before the next one`),
  );
});

const factsOf = (id) => {
  const tool = registry.get(id);
  assert.ok(tool, `${id} is a Tool`);
  const result = engineFactsFor(tool, engines.get(id));
  return { ...result, text: result.facts.join("\n"), unsettledText: result.unsettled.join("\n") };
};

test("a raw .hevc or .av1 input has no audio, whatever the engine", () => {
  // hevc-to-mp4 runs on plain ffmpeg-wasm, av1-to-mp4 on ffmpeg-wasm + webcodecs.
  for (const id of ["hevc-to-mp4", "av1-to-mp4", "hevc-to-av1", "hevc-to-rm"]) {
    assert.match(factsOf(id).text, /input is a raw video stream with no audio track, so the output has no sound/, id);
  }
  assert.match(factsOf("mp4-to-hevc").text, /\.hevc output is a raw video stream with no audio/);
  assert.doesNotMatch(factsOf("mp4-to-mov").text, /raw video stream/);
});

test("transparency in a PDF is claimed only where the engine settles it", () => {
  for (const id of ["png-to-pdf", "heic-to-pdf"]) {
    assert.match(factsOf(id).text, /transparent pixels in the decoded picture stay transparent/, id);
  }
  for (const id of ["psd-to-pdf", "tiff-to-pdf"]) {
    const { text, unsettledText } = factsOf(id);
    assert.doesNotMatch(text, /stay transparent/, id);
    assert.match(unsettledText, /Whether transparency survives in the PDF/, id);
    assert.match(unsettledText, /which layer of a PSD .* ends up in the PDF/, id);
  }
  assert.doesNotMatch(factsOf("psd-to-png").unsettledText, /survives in the PDF/);
});

test("a re-encoded video rounds an odd side down by 1 px", () => {
  assert.match(VIDEO_FILTER, /force_divisible_by=2/);
  assert.match(factsOf("mov-to-mp4").text, /odd width or height loses 1 px/);
  assert.doesNotMatch(factsOf("mkv-to-mp4").text, /loses 1 px/);
});

test("every raster-to-PDF engine states the PDF facts", () => {
  for (const id of ["png-to-pdf", "tiff-to-pdf", "heic-to-pdf", "psd-to-pdf"]) {
    const { text } = factsOf(id);
    assert.match(text, /own PDF; several files are never merged/, id);
    assert.match(text, /1 pixel is 1 point/, id);
    assert.match(text, /embedded losslessly as a PNG/, id);
  }
  assert.match(factsOf("psd-to-pdf").text, /ImageMagick writes a PNG, then the PNG is embedded/);
  assert.doesNotMatch(factsOf("png-to-pdf").text, /ImageMagick writes a PNG/);
  assert.doesNotMatch(factsOf("psd-to-png").text, /ImageMagick writes a PNG/);
});

test("PDF facts are not shown for other targets or for the merged image-to-pdf", () => {
  assert.doesNotMatch(factsOf("jpeg-to-png").text, /1 pixel is 1 point/);
  assert.doesNotMatch(factsOf("image-to-pdf").text, /several files are never merged/);
});

test("png-to-svg says the picture is embedded, not traced", () => {
  const { text } = factsOf("png-to-svg");
  assert.match(text, /not traced/);
  assert.match(text, /data:image|embedded as a PNG/);
  assert.doesNotMatch(factsOf("png-to-pdf").text, /not traced/);
});

test("ICO facts give the 256 px fit and leave alpha unsettled", () => {
  const { text, unsettledText } = factsOf("png-to-ico");
  assert.match(text, /one image, not a set of sizes/);
  assert.match(text, /256 x 256/);
  assert.match(unsettledText, /transparency survives in the ICO/);
});

test("SVG input facts give the browser's size and no background, and leave animation unsettled", () => {
  const { text, unsettledText } = factsOf("svg-to-png");
  assert.match(text, /no scale factor, size cap or viewBox handling/);
  assert.match(text, /canvas starts transparent/);
  assert.match(unsettledText, /animated or scripted SVG/);
  assert.doesNotMatch(factsOf("png-to-svg").text, /viewBox handling/);
});

test("alpha and layer questions stay unsettled", () => {
  assert.match(factsOf("png-to-jpg").unsettledText, /colour fills transparent areas in a JPG/);
  assert.match(factsOf("heic-to-pdf").unsettledText, /alpha plane/);
  assert.match(factsOf("psd-to-pdf").unsettledText, /Which page or layer/);
});

test("mkv-to-mp4 is a remux: no 1920 px / 30 fps cap", () => {
  const { text, command } = factsOf("mkv-to-mp4");
  assert.match(command, /-c copy/);
  assert.match(text, /1920 px \/ 30 fps cap doesn't apply/);
  assert.doesNotMatch(text, /re-encoded and keeps the source's frame size/);
});

test("a re-encoded video output states the cap, and a GIF or audio output does not", () => {
  assert.match(factsOf("avi-to-mp4").text, /re-encoded and keeps the source's frame size and frame rate up to 1920 px .* 30 fps/);
  assert.doesNotMatch(factsOf("mp4-to-gif").text, /up to 1920 px/);
  assert.doesNotMatch(factsOf("mp4-to-mp3").text, /up to 1920 px/);
});

test("no FFmpeg Tool carries the old unqualified cap sentence", () => {
  for (const id of ["mkv-to-mp4", "avi-to-mp4", "mp4-to-gif"]) {
    assert.doesNotMatch(factsOf(id).text, /^Video outputs keep/m, id);
  }
});

test("mp3-to-mp4 is audio only", () => {
  const { text, unsettledText } = factsOf("mp3-to-mp4");
  assert.match(text, /audio only, as AAC at 96 kbit\/s/);
  assert.match(text, /not call it H\.264 video/);
  assert.match(unsettledText, /cover art/);
  assert.doesNotMatch(factsOf("wav-to-mp3").text, /audio only, as AAC/);
});

test("gif-to-mp4 sets no loop", () => {
  const { text, command } = factsOf("gif-to-mp4");
  assert.match(text, /sets no loop option/);
  assert.doesNotMatch(command, /loop/);
});

test("compress-mp4 and compress-gif facts", () => {
  const mp4 = factsOf("compress-mp4");
  assert.match(mp4.text, /Frame size and frame rate aren't changed/);
  assert.doesNotMatch(mp4.command, /-vf|-r |-fpsmax/);
  const gif = factsOf("compress-gif");
  assert.match(gif.text, /Every frame is kept/);
  assert.match(gif.text, /exactly the same pixels/);
});

test("the JPEG compressor facts are @jsquash/jpeg's defaults and the worker's calls", async () => {
  const { label, defaultOptions, defaultDecodeOptions } = await import("@jsquash/jpeg/meta.js");
  const worker = readFileSync(path.join(appRoot, "workers/compress.worker.js"), "utf8");
  // compressJpeg passes no decode options and only a quality to encode.
  assert.match(worker, /await decodeJpeg\(buf\);/);
  assert.match(worker, /encodeJpeg\(imageData, \{ quality: mapQualityToImageQuality\(quality\) \}\)/);
  for (const id of ["compress-jpg", "compress-jpeg"]) {
    const { text: facts } = factsOf(id);
    assert.equal(label, "MozJPEG");
    assert.match(facts, /with MozJPEG/);
    assert.equal(defaultOptions.progressive, true);
    assert.equal(defaultOptions.optimize_coding, true);
    assert.match(facts, /a progressive JPEG with optimised Huffman tables/);
    assert.equal(defaultDecodeOptions.preserveOrientation, false);
    assert.match(facts, /EXIF orientation isn't applied on decode/);
  }
  assert.doesNotMatch(factsOf("compress-webp").text, /MozJPEG/);
});

test("m4a-to-mp3 drops cover art because the command has -vn", () => {
  assert.ok(buildConvertCommand("m4a", "mp3").args.includes("-vn"));
  assert.match(factsOf("m4a-to-mp3").text, /the MP3 has no cover art/);
});

test("a browser-raster output has 8 bits per channel, as the RGBA type holds", () => {
  const heif = readFileSync(path.join(appRoot, "lib/convert/heif.ts"), "utf8");
  assert.match(heif, /export type RGBA = \{ data: Uint8ClampedArray;/);
  assert.match(text("browser-raster"), /a canvas output has 8 bits per channel/);
});

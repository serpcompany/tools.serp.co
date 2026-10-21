// The numbers scripts/lib/engine-facts.mjs tells writers are the engine's own
// (#356): each is read from the constant or builder it cites, so changing an
// engine fails here until its fact is updated. Numbers with no importable
// constant (HeroConverter's 0.82, the 0.85 output quality, ImageMagick's
// 537 megapixels, PDF.js's JPEG 0.9) are listed in PR #364 instead.

import assert from "node:assert/strict";
import test from "node:test";

import { ENGINE_FACTS } from "../scripts/lib/engine-facts.mjs";
import {
  mapQualityToAudioBitrate,
  mapQualityToImageQuality,
  mapQualityToPngLevel,
  mapQualityToVideoCrf,
} from "./compression-utils.ts";
import { MAX_VIDEO_FPS, MAX_VIDEO_SIZE, buildCompressionCommand, buildConvertCommand } from "./convert/ffmpeg-args.ts";
import { IMAGE_PDF_MAX_BYTES, IMAGE_PDF_MAX_IMAGES, IMAGE_PDF_MAX_PIXELS } from "./convert/image-pdf-inputs.ts";
import { MAX_RENDER_PIXELS } from "./convert/pdf.ts";
import { SERVER_ACTION_RATE_LIMIT_WINDOW_MS } from "./server-action-contract.js";

// The compressor's quality (components/HeroConverter.tsx), as the facts state it.
const COMPRESS_QUALITY = 0.82;

const text = (engine) => {
  const entry = ENGINE_FACTS[engine];
  return [entry.where, ...(entry.facts ?? []), ...(entry.convert ?? []), ...(entry.compress ?? [])].join("\n");
};
const flags = (args) => args.join(" ");

test("the FFmpeg facts are the command builders' and the size limits' numbers", () => {
  const ffmpeg = text("ffmpeg-wasm");
  assert.match(ffmpeg, new RegExp(`up to ${MAX_VIDEO_SIZE} px on the longer side and ${MAX_VIDEO_FPS} fps`));

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

test("the image compressor facts are the quality mappings' numbers", () => {
  const quality = mapQualityToImageQuality(COMPRESS_QUALITY);
  assert.match(text("jsquash-worker"), new RegExp(`re-encoded at quality ${quality};`));
  assert.match(text("jsquash-worker"), new RegExp(`oxipng at level ${mapQualityToPngLevel(COMPRESS_QUALITY)}`));
  // compressImageWithMagick sets AVIF to Math.round(quality * 100).
  assert.match(text("imagemagick-wasm"), new RegExp(`AVIF: quality ${Math.round(COMPRESS_QUALITY * 100)}`));
});

test("the PDF and image-to-PDF limits are their constants", () => {
  const side = Math.sqrt(MAX_RENDER_PIXELS);
  assert.ok(Number.isInteger(side));
  assert.match(text("pdfjs"), new RegExp(`capped at ${side} × ${side} pixels`));

  const imagePdf = text("image-pdf");
  assert.match(
    imagePdf,
    new RegExp(
      `Limits: ${IMAGE_PDF_MAX_IMAGES} images, ${IMAGE_PDF_MAX_BYTES / 1024 / 1024} MB in all, ${IMAGE_PDF_MAX_PIXELS / 1_000_000} megapixels per image`,
    ),
  );
});

test("the server's wait between conversions is the server-action cooldown", () => {
  assert.match(
    text("server-video, then ffmpeg-wasm"),
    new RegExp(`waits ${SERVER_ACTION_RATE_LIMIT_WINDOW_MS / 1000} s before the next one`),
  );
});

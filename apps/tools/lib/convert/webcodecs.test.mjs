import test from "node:test";
import assert from "node:assert/strict";

import {
  CODEC_UNSUPPORTED,
  codecUnsupportedError,
  codecUnsupportedMessage,
  ffmpegStepArgs,
  planSteps,
  usesWebCodecs,
} from "./webcodecs.ts";

const sizes = { width: 320, frameRate: 12 };

test("AV1 input and AV1 or HEVC output use the browser's codecs; HEVC input stays on FFmpeg", () => {
  for (const [from, to] of [["av1", "mp4"], ["av1", "gif"], ["mp4", "av1"], ["hevc", "av1"], ["mov", "hevc"], ["AV1", "MKV"]]) {
    assert.equal(usesWebCodecs(from, to), true, `${from} to ${to}`);
  }
  for (const [from, to] of [["hevc", "mp4"], ["mp4", "webm"], ["mkv", "mp4"], ["png", "jpg"]]) {
    assert.equal(usesWebCodecs(from, to), false, `${from} to ${to}`);
  }
});

test("from AV1, the browser hands FFmpeg VP8, which converts it like any other input", () => {
  assert.deepEqual(planSteps("av1", "mp4"), [
    { run: "ffmpeg", args: "copy-av1", output: "source.mkv" },
    { run: "browser", job: "hand-off" },
    { run: "convertVideo" },
  ]);
});

test("to AV1 or HEVC, FFmpeg scales to VP8, the browser encodes and FFmpeg writes the stream", () => {
  assert.deepEqual(planSteps("mp4", "hevc"), [
    { run: "ffmpeg", args: "to-vp8", output: "source.webm" },
    { run: "browser", job: "encode" },
    { run: "ffmpeg", args: "write-hevc", output: "output.hevc" },
  ]);
  assert.deepEqual(planSteps("hevc", "av1").at(-1), { run: "ffmpeg", args: "write-av1", output: "output.av1" });
});

test("AV1 to HEVC decodes in the browser first, so FFmpeg still does the scaling", () => {
  assert.deepEqual(
    planSteps("av1", "hevc").map((step) => step.args ?? step.job),
    ["copy-av1", "hand-off", "to-vp8", "encode", "write-hevc"],
  );
});

test("the hand-off to the browser is scaled like FFmpeg's other outputs and tagged BT.601", () => {
  const args = ffmpegStepArgs("to-vp8", sizes);
  assert.equal(args[args.indexOf("-vf") + 1], "fps=12,scale=320:-2:flags=fast_bilinear:out_color_matrix=bt601");
  assert.equal(args[args.indexOf("-colorspace") + 1], "smpte170m");
  assert.equal(args[args.indexOf("-c:v") + 1], "libvpx");
  assert.ok(args.includes("-an"));
});

test("the .av1 stream is copied with any audio; outputs are IVF and Annex B with the frame rate", () => {
  assert.deepEqual(ffmpegStepArgs("copy-av1", sizes), ["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy"]);
  const ivf = ffmpegStepArgs("write-av1", sizes);
  assert.equal(ivf[ivf.indexOf("-f") + 1], "ivf");
  const hevc = ffmpegStepArgs("write-hevc", sizes);
  assert.equal(hevc[hevc.indexOf("-f") + 1], "hevc");
  assert.equal(hevc[hevc.indexOf("-bsf:v") + 1], "hevc_mp4toannexb,hevc_metadata=tick_rate=12");
});

test("a browser without the codec is told which one and where to go", () => {
  assert.equal(codecUnsupportedMessage("encode", "hevc"), "This browser can't encode HEVC. Try Chrome or Edge.");
  assert.equal(codecUnsupportedMessage("decode", "av1"), "This browser can't decode AV1. Try Chrome or Edge.");
  const error = codecUnsupportedError("encode", "av1", "mp4", "av1");
  assert.equal(error.message, "This browser can't encode AV1. Try Chrome or Edge.");
  // The converters record this code as a hand-off, not a failure.
  assert.equal(error.telemetryCode, CODEC_UNSUPPORTED);
  assert.deepEqual(error.telemetryMetadata, { from: "mp4", to: "av1", engine: "webcodecs", format: "av1" });
});

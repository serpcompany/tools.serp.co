import test from "node:test";
import assert from "node:assert/strict";

import { buildCompressionCommand, buildConvertCommand, fitWithin } from "./ffmpeg-args.ts";

const VIDEO_INPUTS = ["3gp", "avi", "flv", "mjpeg", "mkv", "mov", "mp4", "mpeg", "rm", "swf", "ts", "webm"];
// Video outputs FFmpeg encodes at the source's size and rate, within limits.
// 3GP (H.263 frame sizes) and MXF (a broadcast rate) have their own.
const VIDEO_TARGETS = [
  "mp4", "mkv", "webm", "avi", "mov", "flv", "ts", "mts", "m2ts", "m4v", "mpeg", "mpg", "vob",
  "f4v", "divx", "avchd", "mjpeg", "mpeg2", "asf", "wmv", "ogv", "swf",
];

// The value of the last occurrence of an option, as FFmpeg reads it.
function option(args, name) {
  const index = args.lastIndexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

// The frame size the encoder receives: -s, or the size a trailing pad= filter makes.
function frameSize(args) {
  const size = option(args, "-s");
  if (size) return size;
  const pad = /pad=(\d+):(\d+)/.exec(option(args, "-vf") ?? "");
  return pad ? `${pad[1]}x${pad[2]}` : undefined;
}

// The frame FFmpeg's scale filter makes of a width x height source from a
// fitWithin filter: the box is min(source, limit) on each side, the frame is
// shrunk to fit it keeping its shape, and both sides are rounded down to even.
function fittedSize(filter, width, height) {
  const match = /^scale=w='min\(iw,(\d+)\)':h='min\(ih,(\d+)\)':force_original_aspect_ratio=decrease:force_divisible_by=2/.exec(filter);
  assert.ok(match, filter);
  const boxW = Math.min(width, Number(match[1]));
  const boxH = Math.min(height, Number(match[2]));
  const w = Math.min(boxW, Math.round((boxH * width) / height));
  const h = Math.min(boxH, Math.round((boxW * height) / width));
  return `${w - (w % 2)}x${h - (h % 2)}`;
}

test("video outputs keep the source's size up to 1920 px on the longer side, never scaled up", () => {
  for (const to of [...VIDEO_TARGETS, "mxf"]) {
    const filter = option(buildConvertCommand("avi", to).args, "-vf");
    assert.equal(filter, fitWithin(1920), to);
    assert.equal(fittedSize(filter, 1280, 720), "1280x720", to);
    assert.equal(fittedSize(filter, 1920, 1080), "1920x1080", to);
    assert.equal(fittedSize(filter, 3840, 2160), "1920x1080", to);
    assert.equal(fittedSize(filter, 2160, 3840), "1080x1920", to);
    assert.equal(fittedSize(filter, 320, 240), "320x240", to);
    // Odd sides are rounded down: 4:2:0 encoders need even ones.
    assert.equal(fittedSize(filter, 321, 241), "320x240", to);
  }
});

test("video outputs keep the source's frame rate up to 30 fps, without adding frames", () => {
  for (const to of VIDEO_TARGETS) {
    const { args } = buildConvertCommand("mov", to);
    assert.equal(option(args, "-fpsmax"), "30", to);
    assert.equal(option(args, "-r"), undefined, to);
    assert.doesNotMatch(option(args, "-vf"), /fps=/, to);
  }
});

test("a remux keeps the streams as they are", () => {
  for (const [from, to] of [["mkv", "mp4"], ["mp4", "mkv"], ["mp4", "mov"], ["mp4", "ts"]]) {
    const { args } = buildConvertCommand(from, to);
    assert.equal(option(args, "-c"), "copy", `${from} to ${to}`);
    assert.equal(option(args, "-vf"), undefined, `${from} to ${to}`);
    assert.equal(option(args, "-fpsmax"), undefined, `${from} to ${to}`);
  }
});

test("GIF output is at most 480 px on the longer side, at 15 fps, in both passes", () => {
  const { prepass, args } = buildConvertCommand("mp4", "gif");
  const filter = `fps=15,${fitWithin(480)}`;
  assert.equal(option(prepass, "-vf"), `${filter},palettegen`);
  assert.equal(option(args, "-lavfi"), `${filter}[x];[x][1:v]paletteuse`);
  assert.equal(fittedSize(fitWithin(480), 1920, 1080), "480x270");
  assert.equal(fittedSize(fitWithin(480), 1080, 1920), "270x480");
  assert.equal(fittedSize(fitWithin(480), 320, 240), "320x240");
});

test("3GP output stays CIF at 12 fps, whatever the source", () => {
  for (const from of VIDEO_INPUTS) {
    const { args } = buildConvertCommand(from, "3gp");
    assert.equal(option(args, "-r"), "12", from);
    assert.equal(option(args, "-fpsmax"), undefined, from);
  }
});

test("3GP output encodes H.263 at one of the frame sizes H.263 allows", () => {
  const h263Sizes = ["128x96", "176x144", "352x288", "704x576", "1408x1152"];
  for (const from of VIDEO_INPUTS) {
    const { args } = buildConvertCommand(from, "3gp");
    assert.equal(option(args, "-c:v"), "h263", from);
    assert.ok(h263Sizes.includes(frameSize(args)), `${from}: ${frameSize(args)}`);
  }
});

test("MXF output carries 48 kHz audio at a broadcast frame rate", () => {
  for (const from of VIDEO_INPUTS) {
    const { args, outputName } = buildConvertCommand(from, "mxf");
    assert.equal(outputName, "output.mxf");
    assert.equal(option(args, "-ar"), "48000", from);
    assert.ok(["24", "25", "30", "50", "60"].includes(option(args, "-r")), from);
    assert.equal(option(args, "-fpsmax"), undefined, from);
  }
});

test("Opus output keeps libopus below the complexity that crashes on stereo", () => {
  const commands = [
    buildConvertCommand("caf", "opus"),
    buildConvertCommand("mp4", "opus"),
    buildCompressionCommand("opus", 0.7),
  ];
  for (const { args } of commands) {
    assert.equal(option(args, "-acodec"), "libopus");
    const level = Number(option(args, "-compression_level"));
    assert.ok(Number.isInteger(level) && level <= 4, `compression_level ${option(args, "-compression_level")}`);
  }
});

test("each command reads its input file first and ends with its output file", () => {
  const firstInput = (args) => args[args.indexOf("-i") + 1];
  for (const [from, to] of [["mp4", "3gp"], ["mov", "mxf"], ["rm", "gif"], ["wav", "opus"], ["mkv", "webm"]]) {
    const { args, inputName, outputName } = buildConvertCommand(from, to);
    assert.equal(inputName, `input.${from}`);
    assert.equal(firstInput(args), inputName);
    assert.equal(args.at(-1), outputName);
  }
  const { args, inputName, outputName } = buildCompressionCommand("mp3", 0.7);
  assert.deepEqual([firstInput(args), args.at(-1)], [inputName, outputName]);
});

test("GIF output builds its palette from the input first", () => {
  const { prepass, args } = buildConvertCommand("mp4", "gif");
  assert.ok(prepass, "palette pass");
  assert.equal(option(prepass, "-i"), "input.mp4");
  assert.equal(prepass.at(-1), "palette.png");
  assert.ok(args.includes("palette.png"));
});

test("3GP output squares anamorphic pixels before fitting the H.263 frame", () => {
  const filter = option(buildConvertCommand("vob", "3gp").args, "-vf");
  assert.match(filter, /^scale=trunc\(iw\*sar\/2\)\*2:ih,setsar=1,scale=352:288:/);
});

import test from "node:test";
import assert from "node:assert/strict";

import { buildCompressionCommand, buildConvertCommand } from "./ffmpeg-args.ts";

const VIDEO_INPUTS = ["3gp", "avi", "flv", "mjpeg", "mkv", "mov", "mp4", "mpeg", "rm", "swf", "ts", "webm"];

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

import test from "node:test";
import assert from "node:assert/strict";

import { multipleOutputName, outputExtension, outputFileName } from "./output-name.ts";

test("MPEG-2 downloads as .mpg and AVCHD as .m2ts, extensions players recognize (owner, #373)", () => {
  assert.equal(outputFileName("holiday.mp4", "mpeg2"), "holiday.mpg");
  assert.equal(outputFileName("holiday.mp4", "avchd"), "holiday.m2ts");
  assert.equal(outputExtension("mpeg2"), "mpg");
  assert.equal(outputExtension("avchd"), "m2ts");
});

test("every other target downloads under its own id", () => {
  for (const to of ["png", "mp4", "mpg", "m2ts", "divx", "mjpeg", "cdda", "alac", "av1", "hevc"]) {
    assert.equal(outputExtension(to), to);
    assert.equal(outputFileName("clip.avi", to), `clip.${to}`);
  }
});

test("only the last extension is replaced, and a name without one gains it", () => {
  assert.equal(outputFileName("my.trip.v2.mov", "mpeg2"), "my.trip.v2.mpg");
  assert.equal(outputFileName("camera", "avchd"), "camera.m2ts");
});

test("a compression keeps its extension and adds _compressed", () => {
  assert.equal(outputFileName("song.mp3", "mp3", "_compressed"), "song_compressed.mp3");
});

test("several outputs take the same extension", () => {
  assert.equal(multipleOutputName("report.pdf", "mpeg2", 1), "report_page2.mpg");
  assert.equal(multipleOutputName("clip.mp4", "avchd", 0, ["part1"]), "clip_part1.m2ts");
});

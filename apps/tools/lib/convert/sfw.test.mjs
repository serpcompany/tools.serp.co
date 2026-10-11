import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sfwToJpeg } from "./sfw.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");

test("an SFW file's first image comes out as a JFIF JPEG", () => {
  const sfw = new Uint8Array(readFileSync(path.join(fixtures, "sample.sfw")));
  const jpeg = sfwToJpeg(sfw);
  assert.deepEqual([...jpeg.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(new TextDecoder().decode(jpeg.subarray(6, 10)), "JFIF");
  assert.deepEqual([...jpeg.subarray(-2)], [0xff, 0xd9]);
  // The fixture's second image, its thumbnail, is left out.
  assert.ok(jpeg.length < 43_357 - 347 + 2, `${jpeg.length} bytes`);
  // The input is left as it was.
  assert.equal(new TextDecoder().decode(sfw.subarray(0, 6)), "SFW94A");
});

test("a file that isn't SFW is refused", () => {
  assert.throws(() => sfwToJpeg(new TextEncoder().encode("SFW94A but nothing else")), /Seattle FilmWorks/);
  // Starts like SFW, ends before its start of scan.
  assert.throws(() => sfwToJpeg(Uint8Array.from([0xff, 0xc8, 0xff, 0xd0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), /Seattle FilmWorks/);
});

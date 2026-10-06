import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { read as readKtx2 } from "ktx-parse";

import {
  buildIcns,
  decodeKtx1,
  decodeKtx2,
  encodeKtx1,
  encodeKtx2,
  largestIcnsPng,
} from "./texture-formats.ts";
import { checkOutputFormat } from "./output-format.ts";

const png = new Uint8Array(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures/sample.png")),
);

// A 3x2 image with distinct colors and alphas.
const image = {
  width: 3,
  height: 2,
  data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 200, 0, 0, 255, 100,
    10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 128,
  ]),
};

test("ICNS files pass the output check and give back their largest PNG", () => {
  const icns = buildIcns([
    { type: "icp4", png: png.subarray(0, 64) },
    { type: "ic08", png },
  ]);
  assert.deepEqual(checkOutputFormat(icns.buffer, "icns"), { ok: true });
  assert.equal(new DataView(icns.buffer).getUint32(4), icns.length);
  assert.deepEqual(largestIcnsPng(icns), png);
});

test("ICNS files without PNG images fail with a clear message", () => {
  const legacy = buildIcns([{ type: "it32", png: new Uint8Array([1, 2, 3, 4]) }]);
  assert.throws(() => largestIcnsPng(legacy), /legacy/);
  assert.throws(() => largestIcnsPng(png), /isn't an ICNS/);
});

test("KTX 1 round-trips RGBA pixels and passes the output check", () => {
  const ktx = encodeKtx1(image);
  assert.deepEqual(checkOutputFormat(ktx.buffer, "ktx"), { ok: true });
  const back = decodeKtx1(ktx);
  assert.deepEqual([back.width, back.height], [3, 2]);
  assert.deepEqual([...back.data], [...image.data]);
});

test("KTX 2 round-trips RGBA pixels as sRGB RGBA8 and passes the output check", () => {
  const ktx2 = encodeKtx2(image);
  assert.deepEqual(checkOutputFormat(ktx2.buffer, "ktx2"), { ok: true });
  const container = readKtx2(ktx2);
  assert.equal(container.vkFormat, 43);
  assert.equal(container.dataFormatDescriptor[0].samples.length, 4);
  const back = decodeKtx2(ktx2);
  assert.deepEqual([back.width, back.height], [3, 2]);
  assert.deepEqual([...back.data], [...image.data]);
});

test("compressed KTX 2 textures fail with a clear message", () => {
  const ktx2 = encodeKtx2(image);
  // vkFormat lives at byte 12; 145 is BC7_SRGB.
  new DataView(ktx2.buffer).setUint32(12, 145, true);
  assert.throws(() => decodeKtx2(ktx2), /Compressed KTX2/);
});

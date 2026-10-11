import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkOutputFormat } from "./output-format.ts";

// The real ImageMagick WASM build the site ships, loaded the way the page
// loads it: magickBrowser.ts fetches the wasm, so fetch serves it from disk.
const require = createRequire(import.meta.url);
const wasm = readFileSync(
  path.join(path.dirname(require.resolve("@imagemagick/magick-wasm")), "magick.wasm"),
);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(wasm);
test.after(() => {
  globalThis.fetch = originalFetch;
});
const { convertWithMagickInBrowser, encodePngWithMagick } = await import("./magickBrowser.ts");
const { convertWithWorker } = await import("./workerClient.ts");
// The same module instance magickBrowser.ts initialised, for reading outputs back.
const magick = await import("@imagemagick/magick-wasm");

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const read = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

// ICO and CUR directory entries store width and height in one byte each; 0 means 256.
function iconSize(buffer) {
  const bytes = new Uint8Array(buffer);
  return { width: bytes[6] || 256, height: bytes[7] || 256 };
}

test("camera RAW converts to ICO and CUR at no more than 256 px a side", async () => {
  for (const [file, from, to, size] of [
    ["sample.cr2", "cr2", "ico", { width: 256, height: 192 }],
    ["sample.cr2", "cr2", "cur", { width: 256, height: 192 }],
    ["sample.dng", "dng", "ico", { width: 256, height: 256 }],
  ]) {
    const { buffer, format } = await convertWithMagickInBrowser(read(file), from, to);
    assert.equal(format, to);
    assert.deepEqual(checkOutputFormat(buffer, to), { ok: true }, `${from} to ${to}`);
    assert.deepEqual(iconSize(buffer), size, `${from} to ${to}`);
  }
});

test("a PNG larger than 256 px encodes to ICO, fitted inside 256 px", async () => {
  const { buffer: png } = await convertWithMagickInBrowser(read("sample.dng"), "dng", "png");
  const ico = await encodePngWithMagick(png, "ico");
  const buffer = await ico.arrayBuffer();
  assert.deepEqual(checkOutputFormat(buffer, "ico"), { ok: true });
  assert.deepEqual(iconSize(buffer), { width: 256, height: 256 });
});

// The image data of an icon's first entry: its offset is the uint32 at byte 18.
function firstIconEntry(buffer) {
  const bytes = new Uint8Array(buffer);
  return bytes.subarray(new DataView(bytes.buffer, bytes.byteOffset).getUint32(18, true));
}
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A 256 px icon is stored as a PNG, as magick-wasm 0.0.37 wrote it; without
// icon:png-compression-size, 0.0.42 wrote a 270,398-byte bitmap.
test("a 256 px icon stores its image as a PNG", async () => {
  const { buffer: dngIco } = await convertWithMagickInBrowser(read("sample.dng"), "dng", "ico");
  const { buffer: dngCur } = await convertWithMagickInBrowser(read("sample.dng"), "dng", "cur");
  // A flat 512 x 512 PNG, made by ImageMagick.
  const image = magick.MagickImage.create(new magick.MagickColor("#3366CC"), 512, 512);
  const flat = image.write(magick.MagickFormat.Png, (data) => data.slice());
  image.dispose();
  const flatIco = await (await encodePngWithMagick(flat.buffer, "ico")).arrayBuffer();
  const flatCur = await (await encodePngWithMagick(flat.buffer, "cur")).arrayBuffer();
  for (const [name, buffer, most] of [
    ["DNG to ICO", dngIco, 130_000],
    ["DNG to CUR", dngCur, 130_000],
    ["flat PNG to ICO", flatIco, 2_000],
    ["flat PNG to CUR", flatCur, 2_000],
  ]) {
    assert.deepEqual(iconSize(buffer), { width: 256, height: 256 }, name);
    assert.deepEqual([...firstIconEntry(buffer).subarray(0, 8)], PNG_SIGNATURE, `${name}: the entry isn't a PNG`);
    assert.ok(buffer.byteLength < most, `${name} is ${buffer.byteLength} bytes`);
  }
});

test("a small image keeps its size as an icon", async () => {
  const ico = await encodePngWithMagick(read("sample.png"), "ico");
  assert.deepEqual(iconSize(await ico.arrayBuffer()), { width: 96, height: 96 });
});

test("the wasm the site serves is the installed ImageMagick package's", () => {
  const vendored = readFileSync(path.resolve(fixtures, "../../public/vendor/imagemagick/magick.wasm"));
  assert.ok(vendored.equals(wasm), "public/vendor/imagemagick/magick.wasm differs from @imagemagick/magick-wasm");
});

// Mean and standard deviation (0-255) of every channel, as native ImageMagick
// reads the fixture (`magick <file> -format "%[fx:mean*255]
// %[fx:standard_deviation*255]" info:`). Before 0.0.38 (LibRaw 0.22) this
// Nikon lossy NEF decoded as all white and the ORF as coloured noise.
test("camera RAW decodes to the photo native ImageMagick reads", async () => {
  for (const [file, from, native] of [
    ["sample.nef", "nef", { mean: 111.7, sd: 81.2 }],
    ["sample.orf", "orf", { mean: 105.1, sd: 53.8 }],
  ]) {
    const { buffer } = await convertWithMagickInBrowser(read(file), from, "png");
    const { mean, standardDeviation } = magick.ImageMagick.read(new Uint8Array(buffer), magick.MagickFormat.Png, (image) =>
      image.statistics().composite(),
    );
    assert.ok(Math.abs(mean - native.mean) < 2, `${from} mean ${mean.toFixed(1)}, native ${native.mean}`);
    assert.ok(Math.abs(standardDeviation - native.sd) < 2, `${from} sd ${standardDeviation.toFixed(1)}, native ${native.sd}`);
  }
});

// Mean and standard deviation (0-255) of every channel of each fixture as
// native ImageMagick writes it to PNG: `magick <file> png:- | magick -
// -format "%[fx:mean*255] %[fx:standard_deviation*255]" info:`, with `mac:`
// named for MacPaint, and EXR and HDR encoded to sRGB (`-set colorspace RGB
// -colorspace sRGB` for EXR, `-colorspace sRGB` for HDR). Before #263 the
// browser's own decoder got all of them, and failed.
const NATIVE = {
  pam: { mean: 146.9, sd: 72.9 },
  pbm: { mean: 166.6, sd: 121.4 },
  pgm: { mean: 149.2, sd: 54.3 },
  ppm: { mean: 146.9, sd: 72.9 },
  pcx: { mean: 146.9, sd: 72.9 },
  jxl: { mean: 146.9, sd: 72.8 },
  jp2: { mean: 146.9, sd: 72.9 },
  xpm: { mean: 146.8, sd: 73.0 },
  wpg: { mean: 146.8, sd: 73.0 },
  pcd: { mean: 152.2, sd: 90.1 },
  mac: { mean: 193.9, sd: 108.8 },
  sfw: { mean: 111.5, sd: 68.0 },
  exr: { mean: 146.9, sd: 72.9 },
  hdr: { mean: 146.4, sd: 73.2 },
};

const pngStatistics = (buffer) =>
  magick.ImageMagick.read(new Uint8Array(buffer), magick.MagickFormat.Png, (image) => {
    const { mean, standardDeviation } = image.statistics().composite();
    return { mean, sd: standardDeviation, width: image.width, height: image.height, gamma: image.gamma };
  });

test("Netpbm, PCX, JXL, JP2, XPM, WPG, Photo CD, MacPaint, SFW, EXR and HDR decode to the picture native ImageMagick reads", async () => {
  for (const [from, native] of Object.entries(NATIVE)) {
    const { buffer, format } = await convertWithMagickInBrowser(read(`sample.${from}`), from, "png");
    assert.equal(format, "png", from);
    const { mean, sd } = pngStatistics(buffer);
    assert.ok(Math.abs(mean - native.mean) < 1, `${from} mean ${mean.toFixed(1)}, native ${native.mean}`);
    assert.ok(Math.abs(sd - native.sd) < 1, `${from} sd ${sd.toFixed(1)}, native ${native.sd}`);
  }
});

// A 4 x 1 Radiance HDR, uncompressed: each pixel is a shared-exponent RGBE
// grey of 0, 0.25, 1 and 16.
function radianceHdr() {
  const header = new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 4\n");
  // value = mantissa * 2^(exponent - 136)
  const pixels = [
    [0, 0, 0, 0],
    [128, 128, 128, 127],
    [128, 128, 128, 129],
    [128, 128, 128, 133],
  ].flat();
  return Uint8Array.from([...header, ...pixels]).buffer;
}

test("HDR and EXR: linear light is encoded to sRGB and values above 1.0 are white", async () => {
  const { buffer } = await convertWithMagickInBrowser(radianceHdr(), "hdr", "png");
  const greys = magick.ImageMagick.read(new Uint8Array(buffer), magick.MagickFormat.Png, (image) =>
    [0, 1, 2, 3].map((x) => image.getPixels((pixels) => pixels.getPixel(x, 0)[0])),
  );
  // 0.25 linear is 137 in sRGB; 1.0 and 16 are both white.
  assert.deepEqual(greys, [0, 137, 255, 255]);
  // Tagged as sRGB, not gamma 1.0, which a viewer would show washed out.
  for (const from of ["exr", "hdr"]) {
    const { buffer: png } = await convertWithMagickInBrowser(read(`sample.${from}`), from, "png");
    assert.ok(Math.abs(pngStatistics(png).gamma - 1 / 2.2) < 0.001, `${from} gamma ${pngStatistics(png).gamma}`);
  }
});

// The share of an image's pixels that aren't white (within 8 of 255).
function inkShare(buffer, format) {
  return magick.ImageMagick.read(new Uint8Array(buffer), format, (image) => {
    const rgba = image.getPixels((pixels) => pixels.toByteArray(0, 0, image.width, image.height, "RGBA"));
    let ink = 0;
    for (let index = 0; index < rgba.length; index += 4) if (rgba[index] < 247) ink += 1;
    return ink / (rgba.length / 4);
  });
}

test("TTF and OTF convert to a specimen of the font, a few kilobytes as PNG or TIFF", async () => {
  for (const from of ["ttf", "otf"]) {
    const { buffer: png } = await convertWithMagickInBrowser(read(`sample.${from}`), from, "png");
    const { buffer: tiff, format } = await convertWithMagickInBrowser(read(`sample.${from}`), from, "tiff");
    assert.equal(format, "tiff");
    assert.deepEqual(checkOutputFormat(tiff, "tiff"), { ok: true }, from);
    const { width, height } = pngStatistics(png);
    // Name, three lines of characters and five pangrams, at most 2400 px wide.
    assert.ok(width >= 400 && width <= 2400 && height > 400 && height < 800, `${from} specimen is ${width} x ${height}`);
    // The fixture fonts draw only S E R P T O L, still more than twice the
    // 0.1% of the picture the sweep's blank check needs.
    assert.ok(inkShare(png, magick.MagickFormat.Png) > 0.002, `${from} specimen is nearly blank`);
    // Grey, and LZW in a TIFF: about 1 MB uncompressed.
    assert.ok(png.byteLength < 10_000 && tiff.byteLength < 10_000, `${from}: PNG ${png.byteLength}, TIFF ${tiff.byteLength} bytes`);
  }
});

test("a file that isn't a font says so", async () => {
  const text = new TextEncoder().encode("not a font").buffer;
  await assert.rejects(convertWithMagickInBrowser(text, "ttf", "png"), /isn't a font the converter can read/);
  // The next font still draws.
  const { buffer } = await convertWithMagickInBrowser(read("sample.otf"), "otf", "png");
  assert.deepEqual(checkOutputFormat(buffer, "png"), { ok: true });
});

test("each new input converts through the converter with ImageMagick, not the browser's decoder", async () => {
  // With no worker, the browser-decoder path would throw.
  for (const from of [...Object.keys(NATIVE), "ttf", "otf"]) {
    const result = await convertWithWorker({ worker: undefined, from, to: "png", buf: read(`sample.${from}`) });
    assert.equal(result.kind, "single", from);
    assert.deepEqual(checkOutputFormat(result.buffer, "png"), { ok: true }, from);
  }
});

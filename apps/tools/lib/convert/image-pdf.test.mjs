import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ColorSpace,
  ImageMagick,
  Interlace,
  MagickFormat,
  MagickReadSettings,
  initializeImageMagick,
} from "@imagemagick/magick-wasm";
import { unzlibSync } from "fflate";
import { deflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import UPNG from "upng-js";

import {
  IMAGE_PDF_ACCEPT,
  IMAGE_PDF_MAX_IMAGES,
  IMAGE_PDF_MAX_PIXELS,
  imageFormatOf,
  imagePdfName,
} from "./image-pdf-inputs.ts";
import {
  MAX_PAGE_SIDE,
  PHOTO_QUALITY,
  embedsAsIs,
  imagesToPdf,
  isLosslessWebp,
  jpegImageData,
  placement,
  imageRows,
  readJpeg,
} from "./image-pdf.ts";
import { checkOutputFormat } from "./output-format.ts";

const require = createRequire(import.meta.url);
await initializeImageMagick(
  readFileSync(path.join(path.dirname(require.resolve("@imagemagick/magick-wasm")), "magick.wasm")),
);

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const bytesOf = (name) => new Uint8Array(readFileSync(path.join(fixtures, name)));
const file = (name, bytes = bytesOf(path.basename(name))) => ({
  name,
  arrayBuffer: async () => bytes.slice().buffer,
});

// The test's own decoders: UPNG for PNG, native-free ImageMagick WASM for the
// rest, both to 8-bit RGBA; JPEGs written by ImageMagick.
function magickPixels(bytes, format) {
  return ImageMagick.read(bytes, format, (image) => {
    image.colorSpace = ColorSpace.SRGB;
    const data = image.getPixels((pixels) => pixels.toByteArray(0, 0, image.width, image.height, "RGBA"));
    return { data: new Uint8Array(data), width: image.width, height: image.height };
  });
}
function pngPixels(bytes) {
  const png = UPNG.decode(bytes.slice().buffer);
  return { data: new Uint8Array(UPNG.toRGBA8(png)[0]), width: png.width, height: png.height };
}
function jpegOf(pixels, { quality = 92, colorSpace, interlace } = {}) {
  const settings = new MagickReadSettings({ format: MagickFormat.Rgba, width: pixels.width, height: pixels.height });
  return ImageMagick.read(pixels.data, settings, (image) => {
    image.quality = quality;
    if (colorSpace) image.colorSpace = colorSpace;
    if (interlace) image.settings.interlace = interlace;
    return image.write(MagickFormat.Jpeg, (data) => data.slice());
  });
}
function testDecoders() {
  const calls = { decode: [], encodeJpeg: [] };
  return {
    calls,
    decoders: {
      async decode(format, buffer) {
        calls.decode.push(format);
        const bytes = new Uint8Array(buffer);
        if (format === "png") return pngPixels(bytes);
        const names = { pcx: MagickFormat.Pcx, ppm: MagickFormat.Ppm, jpg: MagickFormat.Jpeg };
        return magickPixels(bytes, names[format]);
      },
      async encodeJpeg(pixels, quality) {
        calls.encodeJpeg.push(quality);
        return jpegOf(pixels, { quality: Math.round(quality * 100) });
      },
    },
  };
}

// Each page as two independent readers see it: pdf-lib for the image
// XObject's dictionary and stored bytes, pdf.js for the decoded pixels (RGBA),
// the page size and the matrix the image is drawn with.
async function readPages(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes);
  const pdf = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
  const pages = [];
  for (const [index, page] of doc.getPages().entries()) {
    const xobjects = page.node.Resources().lookup(PDFName.of("XObject"));
    const [ref] = xobjects.values();
    const stream = doc.context.lookup(ref, PDFRawStream);
    const entry = (key) => stream.dict.get(PDFName.of(key));
    const view = await pdf.getPage(index + 1);
    const ops = await view.getOperatorList();
    let matrix = null;
    let name = null;
    for (let op = 0; op < ops.fnArray.length; op += 1) {
      if (ops.fnArray[op] === pdfjs.OPS.transform) matrix = [...ops.argsArray[op]];
      if (ops.fnArray[op] === pdfjs.OPS.paintImageXObject) name = ops.argsArray[op][0];
    }
    const image = await new Promise((resolve) => view.objs.get(name, resolve));
    pages.push({
      width: view.view[2],
      height: view.view[3],
      matrix,
      filter: entry("Filter").toString(),
      colorSpace: entry("ColorSpace"),
      softMask: entry("SMask") ? doc.context.lookup(entry("SMask"), PDFRawStream) : null,
      predictor: entry("DecodeParms")?.get(PDFName.of("Predictor"))?.toString() ?? null,
      stored: stream.contents,
      context: doc.context,
      pixels: { width: image.width, height: image.height, data: toRgba(image) },
    });
  }
  return pages;
}

function toRgba({ kind, data, width, height }) {
  if (kind === pdfjs.ImageKind.RGBA_32BPP) return new Uint8Array(data);
  assert.equal(kind, pdfjs.ImageKind.RGB_24BPP, "pdf.js decoded the image as RGB or RGBA");
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba.set(data.subarray(index * 3, index * 3 + 3), index * 4);
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}

const rgbOf = (rgba) => rgba.filter((_, index) => index % 4 !== 3);

test("three images in three formats make one PDF, a page each in the order chosen, each page holding its image", async () => {
  const png = file("chart.png", bytesOf("sample-2.png"));
  const jpeg = file("scan.jpg", bytesOf("sample-text.jpg"));
  const pcx = file("drawing.pcx", bytesOf("sample.pcx"));
  const expected = {
    "chart.png": pngPixels(bytesOf("sample-2.png")),
    "drawing.pcx": magickPixels(bytesOf("sample.pcx"), MagickFormat.Pcx),
  };

  for (const order of [[png, jpeg, pcx], [pcx, png, jpeg]]) {
    const { decoders } = testDecoders();
    const pdf = await imagesToPdf(order, { decoders });
    assert.equal(checkOutputFormat(pdf.slice(0, 16).buffer, "pdf").ok, true);
    const pages = await readPages(pdf);
    assert.equal(pages.length, 3);
    for (const [index, page] of pages.entries()) {
      const { name } = order[index];
      if (name === "scan.jpg") {
        // The JPEG's own image data, at its own size.
        assert.deepEqual([page.width, page.height, page.filter], [480, 120, "/DCTDecode"], name);
        assert.deepEqual(page.stored, jpegImageData(bytesOf("sample-text.jpg")), name);
        assert.deepEqual([page.pixels.width, page.pixels.height], [480, 120], name);
        continue;
      }
      const source = expected[name];
      assert.deepEqual([page.width, page.height], [source.width, source.height], name);
      assert.deepEqual(page.matrix, [source.width, 0, 0, source.height, 0, 0], name);
      assert.equal(page.filter, "/FlateDecode", name);
      assert.deepEqual(rgbOf(page.pixels.data), rgbOf(source.data), name);
    }
  }
});

// An EXIF APP1 segment holding only the orientation tag, big-endian.
function withOrientation(jpeg, orientation) {
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0];
  const body = [..."Exif\0\0"].map((char) => char.charCodeAt(0)).concat(tiff);
  const segment = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  return new Uint8Array([0xff, 0xd8, ...segment, ...jpeg.subarray(2)]);
}

test("a JPEG goes in as it is, and its EXIF orientation turns the page upright", async () => {
  const jpeg = withOrientation(bytesOf("sample-text.jpg"), 6);
  assert.equal(readJpeg(jpeg).orientation, 6);
  const { decoders, calls } = testDecoders();
  const [page] = await readPages(await imagesToPdf([file("phone.jpg", jpeg)], { decoders }));
  assert.deepEqual(calls.decode, []);
  // The image data alone: the EXIF segment is read, then left out.
  assert.deepEqual(page.stored, jpegImageData(bytesOf("sample-text.jpg")));
  // 480 x 120 stored, turned a quarter clockwise: a 120 x 480 page.
  assert.deepEqual([page.width, page.height], [120, 480]);
  assert.deepEqual(page.matrix, [0, -480, 120, 0, 0, 480]);
});

// Where EXIF orientation puts a stored pixel position (x right, y down, 0 to
// 1) on screen, from the tag's definition in the EXIF 2.3 standard.
const SHOWN = {
  1: (x, y) => [x, y],
  2: (x, y) => [1 - x, y],
  3: (x, y) => [1 - x, 1 - y],
  4: (x, y) => [x, 1 - y],
  5: (x, y) => [y, x],
  6: (x, y) => [1 - y, x],
  7: (x, y) => [1 - y, 1 - x],
  8: (x, y) => [y, 1 - x],
};

test("every EXIF orientation is drawn as a browser shows it", () => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { pageWidth, pageHeight, matrix } = placement(300, 200, orientation);
    const [a, b, c, d, e, f] = matrix;
    assert.deepEqual([pageWidth, pageHeight], orientation >= 5 ? [200, 300] : [300, 200], `orientation ${orientation}`);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [0.25, 0.75]]) {
      // Image space has the first row at the top: v = 1 - y.
      const [u, v] = [x, 1 - y];
      const onPage = [a * u + c * v + e, b * u + d * v + f];
      const [sx, sy] = SHOWN[orientation](x, y);
      assert.deepEqual(onPage, [sx * pageWidth, (1 - sy) * pageHeight], `orientation ${orientation} at ${x},${y}`);
    }
  }
});

test("a page larger than Acrobat's 200 inches is scaled to fit, keeping its pixels", () => {
  const { pageWidth, pageHeight } = placement(28_800, 7_200);
  assert.deepEqual([pageWidth, pageHeight], [MAX_PAGE_SIDE, 3_600]);
  assert.deepEqual(placement(4_000, 3_000).pageWidth, 4_000);
});

// A soft gradient with a shape, so every Paeth branch is used.
function pixels(width, height, pixel) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

test("transparency keeps a soft mask, and a grey image is stored in one channel", async () => {
  const transparent = pixels(23, 11, (x, y) => [x * 11, y * 23, (x * y) % 256, x > 15 ? 0 : 128 + y * 10]);
  const grey = pixels(19, 7, (x, y) => {
    const value = (x * 13 + y * 31) % 256;
    return [value, value, value, 255];
  });
  const decoders = {
    decode: async (format) => (format === "png" ? transparent : grey),
    encodeJpeg: async () => assert.fail("lossless images aren't re-encoded"),
  };
  const head = bytesOf("sample.png");
  const pages = await readPages(
    await imagesToPdf([file("logo.png", head), file("scan.pgm", new Uint8Array(64))], { decoders }),
  );
  const [withMask, inGrey] = pages;
  assert.equal(withMask.colorSpace.toString(), "/DeviceRGB");
  assert.ok(withMask.softMask, "the transparent image has a soft mask");
  assert.equal(withMask.softMask.dict.get(PDFName.of("ColorSpace")).toString(), "/DeviceGray");
  assert.deepEqual(withMask.pixels.data, transparent.data);
  assert.equal(inGrey.colorSpace.toString(), "/DeviceGray");
  assert.equal(inGrey.softMask, null);
  assert.equal(unzlibSync(inGrey.stored).length, (19 + (inGrey.predictor ? 1 : 0)) * 7, "one byte a pixel");
  assert.deepEqual(inGrey.pixels.data, grey.data);
});

test("lossless pixels keep whichever is smaller: Paeth rows or the bytes as they are", async () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const smooth = pixels(64, 48, (x, y) => [x * 4, y * 5, (x + y) * 2, 255]);
  const speckled = pixels(64, 48, () => [random() < 0.5 ? 0 : 255, random() < 0.5 ? 0 : 255, random() < 0.5 ? 0 : 255, 255]);
  const chosen = [];
  for (const image of [smooth, speckled]) {
    const decoders = { decode: async () => image, encodeJpeg: async () => assert.fail("not a photo") };
    const [page] = await readPages(await imagesToPdf([file("art.png", bytesOf("sample.png"))], { decoders }));
    const [plain, paeth] = [false, true].map((predicted) => deflateSync(imageRows(image.data, 64, 48, [0, 1, 2], predicted)).length);
    assert.equal(page.stored.length, Math.min(plain, paeth));
    chosen.push(page.predictor ? "paeth" : "plain");
    assert.equal(page.predictor, paeth < plain ? "15" : null);
    assert.deepEqual(page.pixels.data, image.data);
  }
  assert.deepEqual(chosen, ["paeth", "plain"], "the gradient is stored with Paeth, the speckles as they are");
});

test("an opaque photo goes in as a JPEG at quality 92; graphics and transparent photos keep their pixels", async () => {
  const opaque = pixels(40, 30, (x, y) => [x * 6, y * 8, 100, 255]);
  const seeThrough = pixels(40, 30, (x, y) => [x * 6, y * 8, 100, x < 20 ? 255 : 0]);
  const run = async (name, image, bytes = bytesOf(path.basename(name).replace(/^.*\./, "sample."))) => {
    const calls = [];
    const decoders = {
      decode: async () => image,
      encodeJpeg: async (input, quality) => {
        calls.push(quality);
        return jpegOf(input, { quality: Math.round(quality * 100) });
      },
    };
    const [page] = await readPages(await imagesToPdf([file(name, bytes)], { decoders }));
    return { page, calls };
  };

  const photo = await run("IMG_0001.heic", opaque);
  assert.equal(photo.page.filter, "/DCTDecode");
  assert.deepEqual(photo.calls, [PHOTO_QUALITY]);
  assert.equal(PHOTO_QUALITY, 0.92);
  assert.deepEqual([photo.page.width, photo.page.height], [40, 30]);

  for (const [name, image] of [["IMG_0002.heic", seeThrough], ["chart.png", opaque]]) {
    const { page, calls } = await run(name, image);
    assert.equal(page.filter, "/FlateDecode", name);
    assert.deepEqual(calls, [], name);
  }
  // A lossless WebP is a graphic; sample.webp is lossy.
  const lossless = new Uint8Array([...bytesOf("sample.webp").subarray(0, 12), ...[..."VP8L"].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
  assert.equal(isLosslessWebp(lossless), true);
  assert.equal(isLosslessWebp(bytesOf("sample.webp")), false);
  assert.equal((await run("art.webp", opaque, lossless)).page.filter, "/FlateDecode");
  assert.equal((await run("photo.webp", opaque)).page.filter, "/DCTDecode");
});

test("a JPEG a PDF can't hold as it is (CMYK) is decoded and written again", async () => {
  const source = magickPixels(bytesOf("sample.ppm"), MagickFormat.Ppm);
  const cmyk = jpegOf(source, { colorSpace: ColorSpace.CMYK });
  const progressive = jpegOf(source, { interlace: Interlace.Jpeg });
  assert.equal(readJpeg(cmyk).components, 4);
  assert.equal(embedsAsIs(readJpeg(cmyk)), false);
  assert.equal(readJpeg(progressive).frame, 0xc2);
  assert.equal(embedsAsIs(readJpeg(progressive)), true);
  assert.equal(embedsAsIs(readJpeg(bytesOf("sample.jpg"))), true);

  const { decoders, calls } = testDecoders();
  const [page] = await readPages(await imagesToPdf([file("print.jpg", cmyk)], { decoders }));
  assert.deepEqual(calls.decode, ["jpg"]);
  assert.deepEqual(calls.encodeJpeg, [PHOTO_QUALITY]);
  assert.equal(page.filter, "/DCTDecode");
  assert.deepEqual(readJpeg(page.stored).components, 3);
});

// APP2 segments holding `profile` in `parts` pieces.
function withIcc(jpeg, profile, parts = 1) {
  const size = Math.ceil(profile.length / parts);
  const segments = [];
  for (let part = 0; part < parts; part += 1) {
    const body = [..."ICC_PROFILE\0"].map((char) => char.charCodeAt(0));
    body.push(part + 1, parts, ...profile.subarray(part * size, (part + 1) * size));
    segments.push(0xff, 0xe2, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body);
  }
  return new Uint8Array([0xff, 0xd8, ...segments, ...jpeg.subarray(2)]);
}

function fakeProfile(space) {
  const profile = new Uint8Array(300).map((_, index) => index % 251);
  profile.set([..."mntr" + space].map((char) => char.charCodeAt(0)), 12);
  return profile;
}

test("a JPEG's ICC profile goes into the PDF with it, when it matches the image", async () => {
  const profile = fakeProfile("RGB ");
  for (const parts of [1, 2]) {
    const jpeg = withIcc(bytesOf("sample.jpg"), profile, parts);
    const [page] = await readPages(await imagesToPdf([file("p3.jpg", jpeg)], testDecoders()));
    assert.ok(page.colorSpace instanceof PDFArray, `${parts} part(s)`);
    assert.equal(page.colorSpace.get(0).toString(), "/ICCBased");
    const icc = page.context.lookup(page.colorSpace.get(1), PDFRawStream);
    assert.ok(page.colorSpace.get(1) instanceof PDFRef);
    assert.equal(icc.dict.get(PDFName.of("N")).toString(), "3");
    assert.deepEqual(unzlibSync(icc.contents), profile);
  }
  // A CMYK profile on an RGB JPEG is left out, and so is one with a part missing.
  assert.equal(readJpeg(withIcc(bytesOf("sample.jpg"), fakeProfile("CMYK"))).icc, null);
  const twoParts = withIcc(bytesOf("sample.jpg"), profile, 2);
  const secondPart = 2 + 2 + ((twoParts[4] << 8) | twoParts[5]);
  assert.equal(readJpeg(new Uint8Array([0xff, 0xd8, ...twoParts.subarray(secondPart)])).icc, null);
});

const ascii = (text) => [...text].map((char) => char.charCodeAt(0));
const jpegSegment = (marker, body) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const holds = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text, "latin1"));
// How many times marker 0xFF `code` appears. Entropy-coded data never holds
// one: its 0xFF bytes are followed by 0 or a restart marker.
const markerCount = (bytes, code) => bytes.reduce((sum, byte, index) => sum + (byte === 0xff && bytes[index + 1] === code ? 1 : 0), 0);

// A page holding the JPEG's whole file, as this page stored it before: the
// pixels a reader shows for the original.
async function pixelsOfWholeJpeg(jpeg) {
  const { width, height, components } = readJpeg(jpeg);
  const doc = await PDFDocument.create();
  const image = doc.context.register(
    doc.context.stream(jpeg, {
      Type: "XObject",
      Subtype: "Image",
      Width: width,
      Height: height,
      ColorSpace: components === 1 ? "DeviceGray" : "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
    }),
  );
  const page = doc.addPage([width, height]);
  const name = page.node.newXObject("Image", image);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(width, 0, 0, height, 0, 0), drawObject(name), popGraphicsState());
  return (await readPages(await doc.save()))[0].pixels;
}

// A phone photo as it's shared: EXIF with the orientation and a GPS block,
// XMP, an ICC profile, MPF, a comment, then after the image's EOI a second
// image (MPF's, or an Ultra HDR gain map) and a Motion Photo's MP4 video.
function phonePhoto(jpeg, profile) {
  const tiff = [
    ...ascii("MM"), 0, 42, 0, 0, 0, 8,
    // IFD0: the orientation (6), and where the GPS IFD is.
    0, 2, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 38, 0, 0, 0, 0,
    // GPS IFD: GPSMapDatum, 20 ASCII bytes at 56.
    0, 1, 0, 0x12, 0, 2, 0, 0, 0, 20, 0, 0, 0, 56, 0, 0, 0, 0,
    ...ascii("GPS-SECRET-48.8584N\0"),
  ];
  const head = [
    ...jpegSegment(0xe1, [...ascii("Exif\0\0"), ...tiff]),
    ...jpegSegment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>XMP-SECRET GCamera:MotionPhoto=\"1\"</x:xmpmeta>")),
    ...jpegSegment(0xe2, [...ascii("MPF\0MM"), 0, 42, ...ascii("MPF-SECRET")]),
    ...jpegSegment(0xfe, ascii("COMMENT-SECRET")),
  ];
  const withProfile = withIcc(jpeg, profile);
  const video = [0, 0, 0, 0x18, ...ascii("ftypmp42"), 0, 0, 0, 0, ...ascii("mp42isom"), ...ascii("MOTION-PHOTO-VIDEO")];
  return new Uint8Array([0xff, 0xd8, ...head, ...withProfile.subarray(2), ...bytesOf("sample.jpg"), ...video]);
}

test("a JPEG goes in as its image alone: no EXIF, GPS, XMP, MPF, comment, second image or video", async () => {
  const source = magickPixels(bytesOf("sample.ppm"), MagickFormat.Ppm);
  const jpeg = jpegOf(source);
  const profile = fakeProfile("RGB ");
  const photo = phonePhoto(jpeg, profile);
  assert.equal(readJpeg(photo).orientation, 6);

  const { decoders, calls } = testDecoders();
  const [page] = await readPages(await imagesToPdf([file("PXL_20261012.MP.jpg", photo)], { decoders }));
  assert.deepEqual(calls.decode, [], "not decoded");
  const stored = page.stored;
  for (const secret of ["Exif", "GPS-SECRET", "XMP-SECRET", "xmpmeta", "MPF", "COMMENT-SECRET", "ICC_PROFILE", "ftyp", "MOTION-PHOTO"]) {
    assert.equal(holds(stored, secret), false, `${secret} is left out`);
  }
  // One image, SOI to the EOI that ends its scan, and nothing after it.
  assert.deepEqual([...stored.subarray(0, 2), ...stored.subarray(-2)], [0xff, 0xd8, 0xff, 0xd9]);
  assert.deepEqual([markerCount(stored, 0xd8), markerCount(stored, 0xd9), markerCount(stored, 0xda)], [1, 1, 1]);
  assert.ok(stored.length < jpeg.length, "smaller than the bare JPEG, whose JFIF segment goes too");

  // Its orientation and ICC profile, read before they were left out, still apply.
  assert.deepEqual([page.width, page.height], [96, 96]);
  assert.deepEqual(page.matrix, [0, -96, 96, 0, 0, 96]);
  assert.equal(page.colorSpace.get(0).toString(), "/ICCBased");
  assert.deepEqual(unzlibSync(page.context.lookup(page.colorSpace.get(1), PDFRawStream).contents), profile);
  // And the pixels are the ones the whole file shows.
  assert.deepEqual(page.pixels, await pixelsOfWholeJpeg(photo));
});

test("a progressive JPEG keeps every scan, and restart markers and Adobe's colour marker are kept", async () => {
  const source = magickPixels(bytesOf("sample.ppm"), MagickFormat.Ppm);
  const progressive = jpegOf(source, { interlace: Interlace.Jpeg });
  assert.ok(markerCount(progressive, 0xda) > 1, "a progressive JPEG has several scans");
  // Adobe's APP14 with transform 0: the colours are stored as they are, not as
  // YCbCr. Left out, a reader would turn them from YCbCr and show other colours.
  const adobe = jpegSegment(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 0]);
  const asStored = new Uint8Array([0xff, 0xd8, ...adobe, ...jpegOf(source).subarray(2)]);
  assert.notDeepEqual(await pixelsOfWholeJpeg(asStored), await pixelsOfWholeJpeg(jpegOf(source)));
  // sample.jpg has a restart interval (DRI) and restart markers in its scan.
  assert.ok(markerCount(bytesOf("sample.jpg"), 0xdd) === 1 && markerCount(bytesOf("sample.jpg"), 0xd0) > 0);

  for (const [name, jpeg] of [["progressive.jpg", progressive], ["adobe.jpg", asStored], ["restarts.jpg", bytesOf("sample.jpg")]]) {
    const [page] = await readPages(await imagesToPdf([file(name, jpeg)], testDecoders()));
    assert.equal(page.filter, "/DCTDecode", name);
    for (const code of [0xda, 0xdd, 0xd0, 0xc4, 0xdb]) {
      assert.equal(markerCount(page.stored, code), markerCount(jpeg, code), `${name}: marker ${code.toString(16)}`);
    }
    assert.equal(holds(page.stored, "Adobe"), name === "adobe.jpg", name);
    assert.deepEqual(page.pixels, await pixelsOfWholeJpeg(jpeg), name);
  }
});

test("a JPEG whose markers don't make sense is decoded instead", async () => {
  const jpeg = bytesOf("sample.jpg");
  assert.equal(jpegImageData(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null, "no scan");
  assert.equal(jpegImageData(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x40, 0])), null, "a segment past the end");
  const cut = jpegImageData(jpeg.subarray(0, jpeg.length - 40));
  assert.deepEqual([...cut.subarray(-2)], [0xff, 0xd9], "a cut-short file still ends its image");
  // A stray byte after the frame header: readJpeg reads the frame, the walk to the scans fails.
  const sof = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xc0);
  const afterSof = sof + 2 + ((jpeg[sof + 2] << 8) | jpeg[sof + 3]);
  const broken = new Uint8Array([...jpeg.subarray(0, afterSof), 0x00, ...jpeg.subarray(afterSof)]);
  assert.ok(embedsAsIs(readJpeg(broken)));
  assert.equal(jpegImageData(broken), null);
  const { decoders, calls } = testDecoders();
  await imagesToPdf([file("broken.jpg", broken)], { decoders }).catch(() => {});
  assert.deepEqual(calls.decode, ["jpg"]);
});

test("an image over 50 megapixels is refused by name before it's decoded or encoded", async () => {
  assert.equal(IMAGE_PDF_MAX_PIXELS, 50_000_000);
  const message = /^huge\.(xcf|png|jpg) is 10,000 x 5,001 pixels, over the 50 megapixels a browser tab can turn into a PDF page safely\. Make it smaller first\.$/;
  const { decoders: real } = testDecoders();
  const calls = [];
  const decoders = {
    // Only the size: nothing reads these pixels once it's refused.
    decode: async (format, buffer) => {
      calls.push(format);
      return format === "xcf" ? { width: 10_000, height: 5_001, data: new Uint8Array(4) } : real.decode(format, buffer);
    },
    encodeJpeg: async () => assert.fail("not encoded"),
  };
  // After it's decoded, in a batch: the error names that image.
  await assert.rejects(imagesToPdf([file("first.png", bytesOf("sample.png")), file("huge.xcf", bytesOf("sample.xcf"))], { decoders }), {
    telemetryCode: "image_too_large",
    telemetryMetadata: { engine: "image-pdf", format: "xcf" },
    message,
  });
  assert.deepEqual(calls, ["png", "xcf"]);

  // A PNG and a JPEG say their size up front, so they aren't decoded at all.
  const pngOfSize = (width, height) => {
    const png = bytesOf("sample.png").slice();
    new DataView(png.buffer).setUint32(16, width);
    new DataView(png.buffer).setUint32(20, height);
    return png;
  };
  calls.length = 0;
  await assert.rejects(imagesToPdf([file("huge.png", pngOfSize(10_000, 5_001))], { decoders }), { telemetryCode: "image_too_large", message });
  const cmyk = jpegOf(magickPixels(bytesOf("sample.ppm"), MagickFormat.Ppm), { colorSpace: ColorSpace.CMYK });
  const sof = cmyk.findIndex((byte, index) => byte === 0xff && cmyk[index + 1] === 0xc0);
  new DataView(cmyk.buffer, cmyk.byteOffset).setUint16(sof + 5, 5_001);
  new DataView(cmyk.buffer, cmyk.byteOffset).setUint16(sof + 7, 10_000);
  await assert.rejects(imagesToPdf([file("huge.jpg", cmyk)], { decoders }), { telemetryCode: "image_too_large", message });
  assert.deepEqual(calls, []);
  // Exactly 50 megapixels goes on to the decoder.
  const stop = { ...decoders, decode: async (format) => (calls.push(format), assert.fail("decoded")) };
  await assert.rejects(imagesToPdf([file("edge.png", pngOfSize(10_000, 5_000))], { decoders: stop }), { telemetryCode: "convert_failed" });
  assert.deepEqual(calls, ["png"]);
});

test("a large image is compressed a band at a time with the filter a sample chose, and fflate does it without CompressionStream", async () => {
  // 1,500 x 1,000 RGB is 4.5 MB of rows: over the 2 MB tried both ways, and
  // two 4 MB bands.
  // mulberry32: a million values without the floating-point LCG's short cycles.
  let seed = 11;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const smooth = pixels(1500, 1000, (x, y) => [(x * 255) / 1500, (y * 255) / 1000, ((x * y) >> 11) & 255, x < 1400 ? 255 : 90]);
  const speckled = pixels(1500, 1000, () => [random() < 0.5 ? 0 : 255, random() < 0.5 ? 0 : 255, random() < 0.5 ? 0 : 255, 255]);
  const images = [smooth, speckled];
  // The file's first byte says which image it is; its extension says PNG.
  const files = images.map((_, index) => file(`${index}.png`, new Uint8Array([index, ...bytesOf("sample.png").subarray(1)])));
  const decoders = {
    decode: async (_format, buffer) => images[new Uint8Array(buffer)[0]],
    encodeJpeg: async () => assert.fail("not a photo"),
  };
  // What trying both on all the rows would choose.
  const best = images.map(({ data }) => {
    const [plain, paeth] = [false, true].map((predicted) => deflateSync(imageRows(data, 1500, 1000, [0, 1, 2], predicted)).length);
    return paeth < plain ? "15" : null;
  });
  assert.deepEqual(best, ["15", null]);

  const check = async () => {
    const pages = await readPages(await imagesToPdf(files, { decoders }));
    for (const [index, page] of pages.entries()) assert.deepEqual(page.pixels.data, images[index].data, `page ${index + 1}`);
    assert.deepEqual(pages.map((page) => page.predictor), best);
    assert.ok(pages[0].softMask, "the smooth image's transparent edge has a soft mask");
  };
  await check();
  const { CompressionStream } = globalThis;
  delete globalThis.CompressionStream;
  try {
    // Safari before 16.4: the same pages, pixel for pixel.
    await check();
  } finally {
    globalThis.CompressionStream = CompressionStream;
  }
});

test("a file is read as what its bytes say, else as what its extension says", () => {
  const head = (name) => bytesOf(name).subarray(0, 4096);
  assert.equal(imageFormatOf("IMG_0001.jpg", head("sample.heic")), "heic");
  assert.equal(imageFormatOf("photo.png", head("sample.jpg")), "jpg");
  assert.equal(imageFormatOf("photo", head("sample.png")), "png");
  assert.equal(imageFormatOf("pic.heic", head("sample.avif")), "avif");
  assert.equal(imageFormatOf("raw.NEF", head("sample.nef")), "nef");
  assert.equal(imageFormatOf("raw.cr3", head("sample.cr3")), "cr3");
  assert.equal(imageFormatOf("old.mac", head("sample.mac")), "mac");
  assert.equal(imageFormatOf("stereo.jps", head("sample.jpg")), "jpg");
  assert.equal(imageFormatOf("art.xcf", head("sample.xcf")), "xcf");
  assert.equal(imageFormatOf("font.ttf", head("sample.ttf")), null, "a font isn't an image");
  assert.equal(imageFormatOf("notes.txt", head("sample.txt")), null);
  assert.equal(imageFormatOf("clip.mp4", head("sample.mp4")), null);
  for (const format of ["heic", "nef", "xcf", "pcx", "mac", "jps", "svg", "ktx2"]) {
    assert.ok(IMAGE_PDF_ACCEPT.split(",").includes(`.${format}`), format);
  }
  assert.ok(IMAGE_PDF_ACCEPT.startsWith("image/*,"));
});

test("a batch over the limits is refused with a reason, before or while it's built", async () => {
  let reads = 0;
  const many = Array.from({ length: IMAGE_PDF_MAX_IMAGES + 1 }, (_, index) => ({
    name: `${index}.jpg`,
    arrayBuffer: async () => {
      reads += 1;
      return bytesOf("sample.jpg").buffer;
    },
  }));
  await assert.rejects(imagesToPdf(many), { telemetryCode: "too_many_images", message: /up to 100 images/ });
  assert.equal(reads, 0, "nothing is read when there are too many");

  const jpeg = bytesOf("sample.jpg");
  const three = [file("a.jpg", jpeg), file("b.jpg", jpeg), file("c.jpg", jpeg)];
  await assert.rejects(imagesToPdf(three, { maxBytes: jpeg.length * 1.5 }), {
    telemetryCode: "pdf_too_large",
    message: /over 250 MB.*Only the first image fits/,
  });
  await assert.rejects(imagesToPdf(three, { maxBytes: jpeg.length * 2.5 }), { message: /The first 2 images fit/ });
  await assert.rejects(imagesToPdf(three, { maxBytes: 10 }), { message: /^This image makes a PDF over 250 MB/ });
});

test("an unreadable file is named in the error", async () => {
  await assert.rejects(imagesToPdf([file("a.jpg", bytesOf("sample.jpg")), file("notes.txt", bytesOf("sample.txt"))]), {
    telemetryCode: "unsupported_input",
    message: "notes.txt isn't an image this page can read.",
  });
  const decoders = { decode: async () => { throw new Error("Image decode failed."); }, encodeJpeg: async () => new Uint8Array() };
  await assert.rejects(imagesToPdf([file("broken.png", bytesOf("sample.png"))], { decoders }), {
    telemetryCode: "convert_failed",
    telemetryMetadata: { engine: "image-pdf", format: "png" },
    message: "Couldn't read broken.png: Image decode failed.",
  });
});

test("one image keeps its name; a combined PDF is named after its first image", () => {
  assert.equal(imagePdfName(["IMG_0412.HEIC"]), "IMG_0412.pdf");
  assert.equal(imagePdfName(["scan 1.jpg", "scan 2.jpg", "scan 3.jpg"]), "scan 1_combined.pdf");
  assert.equal(imagePdfName([".png"]), "image.pdf");
});

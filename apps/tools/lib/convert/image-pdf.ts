// Image to PDF (image-to-pdf): images into one PDF, one page each, in the
// order given. As jpg-to-pdf, each page is its image's size, one point a
// pixel, and the image fills it. pdf-lib writes the document; each image goes
// in as one of:
//
// - A JPEG's own image data (DCTDecode), so a photo is neither re-encoded nor
//   enlarged. Its EXIF orientation turns the page, as a browser shows it, and
//   its ICC profile (an iPhone's Display P3, say) is embedded with it; the
//   rest of its metadata (EXIF, with GPS, and XMP) and anything stored after
//   the image (a Motion Photo's video, an Ultra HDR gain map) is left out.
// - A JPEG at quality 92, for an opaque photo in any other format (HEIC,
//   AVIF, lossy WebP, camera RAW...): those PDFs would otherwise run to tens
//   of megabytes a page.
// - Lossless pixels: Flate, with PNG predictors where they make it smaller, one
//   channel for greyscale and a soft mask for transparency. pdf-lib's own PNG
//   embedder decodes the PNG again in JavaScript and recompresses it without
//   predictors, twice the size for a photo saved as PNG.
//
// The browser decoders load only when an image needs them, and tests pass
// their own (ImagePdfDecoders).

import {
  PDFDocument,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFRef,
} from "pdf-lib";

import {
  IMAGE_PDF_MAX_BYTES,
  IMAGE_PDF_MAX_PIXELS,
  IMAGE_PDF_MAX_IMAGES,
  imageFormatOf,
  imageTooLargeMessage,
  pdfTooLargeMessage,
  tooManyImagesMessage,
} from "./image-pdf-inputs.ts";
import { MAGICK_BROWSER_INPUTS } from "./magickBrowser.ts";

export type Pixels = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };

// --- JPEG ---------------------------------------------------------------

export type JpegInfo = {
  width: number;
  height: number;
  components: number;
  precision: number;
  // The start-of-frame marker: 0xC0 baseline, 0xC1 extended, 0xC2 progressive...
  frame: number;
  // EXIF orientation, 1 (upright) to 8.
  orientation: number;
  // The embedded ICC profile, when it matches the components.
  icc: Uint8Array | null;
};

const readU16 = (bytes: Uint8Array, at: number, little = false) =>
  little ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!;
const readU32 = (bytes: Uint8Array, at: number, little = false) =>
  little
    ? (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
    : ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
const startsWith = (bytes: Uint8Array, text: string) =>
  bytes.length >= text.length && [...text].every((char, index) => bytes[index] === char.charCodeAt(0));

// The orientation tag (0x0112) of IFD0 in an APP1 EXIF segment's TIFF data.
function exifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const ifd = readU32(tiff, 4, little);
  if (ifd + 2 > tiff.length) return 1;
  const count = readU16(tiff, ifd, little);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) return 1;
    if (readU16(tiff, entry, little) !== 0x0112) continue;
    // A SHORT, stored in the first two bytes of the value field.
    const value = readU16(tiff, entry + 8, little);
    return readU16(tiff, entry + 2, little) === 3 && value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

// Start-of-frame markers; 0xC4 (DHT), 0xC8 (JPG) and 0xCC (DAC) are not frames.
const isFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

// What a PDF needs to know about a JPEG, read from its markers up to the
// frame header; null when it isn't a JPEG this can read.
export function readJpeg(bytes: Uint8Array): JpegInfo | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  const iccChunks = new Map<number, Uint8Array>();
  let iccCount = 0;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // no frame before the scan
    const length = readU16(bytes, offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    const segment = bytes.subarray(offset + 4, end);
    if (marker === 0xe1 && startsWith(segment, "Exif\0\0")) {
      orientation = exifOrientation(segment.subarray(6));
    } else if (marker === 0xe2 && startsWith(segment, "ICC_PROFILE\0") && segment.length > 14) {
      iccCount = segment[13]!;
      iccChunks.set(segment[12]!, segment.subarray(14));
    } else if (isFrame(marker)) {
      if (segment.length < 6) return null;
      const components = segment[5]!;
      return {
        precision: segment[0]!,
        height: readU16(segment, 1),
        width: readU16(segment, 3),
        components,
        frame: marker,
        orientation,
        icc: iccProfile(iccChunks, iccCount, components),
      };
    }
    offset = end;
  }
  return null;
}

// The ICC profile split across APP2 segments, numbered from 1, when every
// part is there and its colour space matches the image's components.
function iccProfile(chunks: Map<number, Uint8Array>, count: number, components: number): Uint8Array | null {
  if (!count || chunks.size !== count) return null;
  const parts: Uint8Array[] = [];
  for (let sequence = 1; sequence <= count; sequence += 1) {
    const part = chunks.get(sequence);
    if (!part) return null;
    parts.push(part);
  }
  const profile = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    profile.set(part, at);
    at += part.length;
  }
  if (profile.length < 128) return null;
  const space = String.fromCharCode(...profile.subarray(16, 20));
  return (components === 3 && space === "RGB ") || (components === 1 && space === "GRAY") ? profile : null;
}

// What every PDF reader's DCTDecode filter reads: 8-bit baseline, extended or
// progressive Huffman JPEG, in greyscale or colour. CMYK is decoded instead,
// since Adobe's inverted CMYK can't be told apart reliably, and so are
// 12-bit, lossless and arithmetic-coded JPEGs.
export function embedsAsIs(info: JpegInfo): boolean {
  return (
    [0xc0, 0xc1, 0xc2].includes(info.frame) &&
    info.precision === 8 &&
    (info.components === 1 || info.components === 3) &&
    info.width > 0 &&
    info.height > 0
  );
}

// Segments a decoder reads besides frames and scans: quantisation and Huffman
// tables (DQT, DHT), arithmetic conditioning (DAC), the restart interval
// (DRI), the line count (DNL) and EXP.
const DECODER_SEGMENTS = new Set([0xdb, 0xc4, 0xcc, 0xdd, 0xdc, 0xdf]);
const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;

// The JPEG's image alone, as a PDF's DCTDecode stream holds it: SOI, the
// tables, the frame, every scan with its entropy-coded data (a progressive
// JPEG has several) and the EOI that ends the last scan, with an Adobe APP14
// segment, which says whether the colours are YCbCr or stored as they are.
// EXIF, XMP, ICC (read by readJpeg first), MPF and the other APP segments and
// comments are left out, and so is everything after that EOI: a Motion
// Photo's video, an Ultra HDR gain map or MPF's other images. Null when the
// markers don't make sense; the image is then decoded instead.
export function jpegImageData(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const kept: [number, number][] = [[0, 2]];
  let scans = 0;
  let offset = 2;
  let ended = false;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      if (!scans) return null;
      kept.push([offset, offset + 2]);
      ended = true;
      break;
    }
    if (marker === 0x01 || isRestart(marker)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd8 || offset + 4 > bytes.length) return null;
    const end = offset + 2 + readU16(bytes, offset + 2);
    if (end < offset + 4 || end > bytes.length) return null;
    if (marker !== 0xda) {
      const adobe = marker === 0xee && startsWith(bytes.subarray(offset + 4, end), "Adobe");
      if (adobe || isFrame(marker) || DECODER_SEGMENTS.has(marker)) kept.push([offset, end]);
      offset = end;
      continue;
    }
    // A scan: its header, then entropy-coded data up to the next marker. In
    // that data a 0xFF is followed by 0 (a stuffed byte), a restart marker or
    // another 0xFF (fill before a marker).
    let at = end;
    for (;;) {
      at = bytes.indexOf(0xff, at);
      if (at < 0 || at + 1 >= bytes.length) {
        at = bytes.length;
        break;
      }
      const next = bytes[at + 1]!;
      if (next !== 0 && next !== 0xff && !isRestart(next)) break;
      at += next === 0xff ? 1 : 2;
    }
    kept.push([offset, at]);
    scans += 1;
    offset = at;
  }
  if (!scans) return null;
  // A file cut short still ends its image, as its decoder would.
  const tail = ended ? [] : [0xff, 0xd9];
  const out = new Uint8Array(kept.reduce((sum, [start, end]) => sum + end - start, tail.length));
  let at = 0;
  for (const [start, end] of kept) {
    out.set(bytes.subarray(start, end), at);
    at += end - start;
  }
  out.set(tail, at);
  return out;
}

// --- Pages ------------------------------------------------------------------

// Acrobat's largest page side, 200 inches. A larger image keeps its pixels
// on a page scaled down to fit.
export const MAX_PAGE_SIDE = 14_400;

export type Placement = {
  pageWidth: number;
  pageHeight: number;
  // The cm operator's matrix, taking the image's unit square onto the page.
  matrix: [number, number, number, number, number, number];
};

// The page an image `width` x `height` gets, stored with EXIF `orientation`,
// and the matrix that draws it upright, as a browser shows it. Orientations 5
// to 8 swap the sides. Image space has the first row at the top (v = 1).
export function placement(width: number, height: number, orientation = 1): Placement {
  const swap = orientation >= 5 && orientation <= 8;
  const scale = Math.min(1, MAX_PAGE_SIDE / Math.max(width, height));
  const w = (swap ? height : width) * scale;
  const h = (swap ? width : height) * scale;
  const matrices: Record<number, Placement["matrix"]> = {
    1: [w, 0, 0, h, 0, 0],
    2: [-w, 0, 0, h, w, 0], // mirrored left to right
    3: [-w, 0, 0, -h, w, h], // upside down
    4: [w, 0, 0, -h, 0, h], // mirrored top to bottom
    5: [0, -h, -w, 0, w, h], // first row on the left, first column at the top
    6: [0, -h, w, 0, 0, h], // turned a quarter clockwise to stand upright
    7: [0, h, w, 0, 0, 0],
    8: [0, h, -w, 0, w, 0], // turned a quarter anticlockwise to stand upright
  };
  return { pageWidth: w, pageHeight: h, matrix: matrices[orientation] ?? matrices[1]! };
}

// The channels at `offsets` of RGBA pixels, rows `from` to `to`. With
// `paeth`, each row is a PNG row filtered with Paeth, as a /Predictor 15 Flate
// stream holds it: a filter byte (4), then each byte's difference from the
// nearest of its left, upper and upper-left neighbours' sum. Without, the
// bytes as they are.
export function imageRows(
  data: ArrayLike<number>,
  width: number,
  height: number,
  offsets: readonly number[],
  paeth: boolean,
  from = 0,
  to = height,
): Uint8Array<ArrayBuffer> {
  const rowBytes = width * offsets.length;
  const out = new Uint8Array((to - from) * (rowBytes + (paeth ? 1 : 0)));
  const stride = width * 4;
  let at = 0;
  for (let y = from; y < to; y += 1) {
    if (paeth) out[at++] = 4;
    const row = y * stride;
    const up = row - stride;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + x * 4;
      for (const offset of offsets) {
        if (!paeth) {
          out[at++] = data[pixel + offset]!;
          continue;
        }
        const left = x > 0 ? data[pixel - 4 + offset]! : 0;
        const above = y > 0 ? data[up + x * 4 + offset]! : 0;
        const corner = x > 0 && y > 0 ? data[up + x * 4 - 4 + offset]! : 0;
        const toLeft = Math.abs(above - corner);
        const toAbove = Math.abs(left - corner);
        const toCorner = Math.abs(left + above - 2 * corner);
        const predicted = toLeft <= toAbove && toLeft <= toCorner ? left : toAbove <= toCorner ? above : corner;
        out[at++] = (data[pixel + offset]! - predicted) & 0xff;
      }
    }
  }
  return out;
}

// zlib, as a Flate stream holds it, of `count` chunks made one at a time by
// `chunk`: the browser's own CompressionStream, or fflate where there's none
// (Safari before 16.4).
async function deflate(count: number, chunk: (index: number) => Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (typeof CompressionStream === "function") {
    const stream = new CompressionStream("deflate");
    const compressed = new Response(stream.readable).arrayBuffer();
    const writer = stream.writable.getWriter();
    for (let index = 0; index < count; index += 1) await writer.write(chunk(index));
    await writer.close();
    return new Uint8Array(await compressed);
  }
  const { Zlib } = await import("fflate");
  const parts: Uint8Array[] = [];
  const zlib = new Zlib();
  zlib.ondata = (part) => parts.push(part);
  for (let index = 0; index < count; index += 1) zlib.push(chunk(index), index === count - 1);
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// Rows are filtered and compressed a band of about 4 MB at a time, so an
// image's rows are never held whole beside its pixels.
const BAND_BYTES = 4 * 1024 * 1024;
// Paeth halves a photo; a screenshot or drawing often compresses better as it
// is. Both are tried on up to 2 MB of rows, all of a small image's or eight
// bands spread down a larger one, and the smaller wins.
const SAMPLE_BYTES = 2 * 1024 * 1024;
const SAMPLE_BANDS = 8;

// The channels at `offsets` as a Flate stream, and whether its rows are Paeth's.
async function flateRows(
  { data, width, height }: Pixels,
  offsets: readonly number[],
): Promise<{ compressed: Uint8Array; paeth: boolean }> {
  const rowBytes = width * offsets.length;
  const rows = (paeth: boolean, from: number, to: number) => imageRows(data, width, height, offsets, paeth, from, to);
  if (rowBytes * height <= SAMPLE_BYTES) {
    const plain = await deflate(1, () => rows(false, 0, height));
    const paeth = await deflate(1, () => rows(true, 0, height));
    return paeth.byteLength < plain.byteLength ? { compressed: paeth, paeth: true } : { compressed: plain, paeth: false };
  }
  const bandRows = Math.max(1, Math.floor(SAMPLE_BYTES / SAMPLE_BANDS / rowBytes));
  const sampleAt = (index: number) => Math.floor((index * (height - bandRows)) / (SAMPLE_BANDS - 1));
  const sample = (paeth: boolean) =>
    deflate(SAMPLE_BANDS, (index) => rows(paeth, sampleAt(index), sampleAt(index) + bandRows));
  const paeth = (await sample(true)).byteLength < (await sample(false)).byteLength;
  const band = Math.max(1, Math.floor(BAND_BYTES / rowBytes));
  const compressed = await deflate(Math.ceil(height / band), (index) =>
    rows(paeth, index * band, Math.min(height, (index + 1) * band)),
  );
  return { compressed, paeth };
}

export type ImagePdf = {
  readonly pageCount: number;
  // Bytes of image data in the PDF so far.
  readonly imageBytes: number;
  addJpeg(jpeg: Uint8Array, info: JpegInfo): void;
  addPixels(pixels: Pixels): Promise<void>;
  save(): Promise<Uint8Array>;
};

export async function createImagePdf(): Promise<ImagePdf> {
  const doc = await PDFDocument.create();
  const { context } = doc;
  let imageBytes = 0;

  const addPage = (image: PDFRef, width: number, height: number, orientation = 1) => {
    const { pageWidth, pageHeight, matrix } = placement(width, height, orientation);
    const page = doc.addPage([pageWidth, pageHeight]);
    const name = page.node.newXObject("Image", image);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...matrix),
      drawObject(name),
      popGraphicsState(),
    );
  };

  const flateImage = async (
    pixels: Pixels,
    offsets: readonly number[],
    colorSpace: string,
    extra: Record<string, PDFRef> = {},
  ) => {
    const { width, height } = pixels;
    const { compressed, paeth: predicted } = await flateRows(pixels, offsets);
    imageBytes += compressed.byteLength;
    return context.register(
      context.stream(compressed, {
        Type: "XObject",
        Subtype: "Image",
        Width: width,
        Height: height,
        ColorSpace: colorSpace,
        BitsPerComponent: 8,
        Filter: "FlateDecode",
        ...(predicted
          ? { DecodeParms: { Predictor: 15, Colors: offsets.length, BitsPerComponent: 8, Columns: width } }
          : {}),
        ...extra,
      }),
    );
  };

  return {
    get pageCount() {
      return doc.getPageCount();
    },
    get imageBytes() {
      return imageBytes;
    },
    addJpeg(jpeg, info) {
      const device = info.components === 1 ? "DeviceGray" : "DeviceRGB";
      const colorSpace = info.icc
        ? ["ICCBased", context.register(context.flateStream(info.icc, { N: info.components, Alternate: device }))]
        : device;
      const image = context.register(
        context.stream(jpeg, {
          Type: "XObject",
          Subtype: "Image",
          Width: info.width,
          Height: info.height,
          ColorSpace: colorSpace,
          BitsPerComponent: 8,
          Filter: "DCTDecode",
        }),
      );
      imageBytes += jpeg.byteLength + (info.icc?.byteLength ?? 0);
      addPage(image, info.width, info.height, info.orientation);
    },
    async addPixels(pixels) {
      const { data } = pixels;
      let opaque = true;
      let grey = true;
      for (let index = 0; index < data.length && (opaque || grey); index += 4) {
        if (data[index + 3] !== 255) opaque = false;
        if (data[index] !== data[index + 1] || data[index] !== data[index + 2]) grey = false;
      }
      const mask: Record<string, PDFRef> = opaque ? {} : { SMask: await flateImage(pixels, [3], "DeviceGray") };
      const image = await flateImage(pixels, grey ? [0] : [0, 1, 2], grey ? "DeviceGray" : "DeviceRGB", mask);
      addPage(image, pixels.width, pixels.height);
    },
    save: () => doc.save(),
  };
}

// --- Sizes from headers -----------------------------------------------------

export type Size = { width: number; height: number };

// A PNG's IHDR, the first chunk.
function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 24 || !startsWith(bytes.subarray(12), "IHDR")) return null;
  return { width: readU32(bytes, 16), height: readU32(bytes, 20) };
}

// A GIF's logical screen, grown to hold its first frame: browsers decode
// the first frame, and Chromium's decoder (Wuffs) makes the image the union
// of the screen and that frame's rectangle.
function gifSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 13 || !startsWith(bytes, "GIF")) return null;
  let width = readU16(bytes, 6, true);
  let height = readU16(bytes, 8, true);
  // The global colour table, when there is one, follows the screen.
  let offset = 13 + (bytes[10]! & 0x80 ? 3 << ((bytes[10]! & 7) + 1) : 0);
  while (offset < bytes.length) {
    if (bytes[offset] === 0x2c) {
      // The image descriptor: left, top, width, height.
      if (offset + 9 > bytes.length) break;
      width = Math.max(width, readU16(bytes, offset + 1, true) + readU16(bytes, offset + 5, true));
      height = Math.max(height, readU16(bytes, offset + 3, true) + readU16(bytes, offset + 7, true));
      break;
    }
    if (bytes[offset] !== 0x21) break;
    // An extension: its label, then sub-blocks up to an empty one.
    offset += 2;
    while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset]! + 1;
    offset += 1;
  }
  return { width, height };
}

// A WebP's first chunk: VP8X's canvas (an animated or transparent WebP), or
// the frame header of a lossy (VP8) or lossless (VP8L) image.
function webpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 30 || !startsWith(bytes, "RIFF") || !startsWith(bytes.subarray(8), "WEBP")) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  const u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
  if (chunk === "VP8X") return { width: u24(24) + 1, height: u24(27) + 1 };
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = readU32(bytes, 21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  // After the 3-byte frame tag, the key frame's start code 9D 01 2A.
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: readU16(bytes, 26, true) & 0x3fff, height: readU16(bytes, 28, true) & 0x3fff };
  }
  return null;
}

// A BMP's DIB header: OS/2's 12-byte core header has 16-bit sides, the
// others signed 32-bit ones (a negative height is stored top down).
function bmpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 26 || !startsWith(bytes, "BM")) return null;
  const header = readU32(bytes, 14, true);
  if (header === 12) return { width: readU16(bytes, 18, true), height: readU16(bytes, 20, true) };
  if (header < 16) return null;
  return { width: Math.abs(readU32(bytes, 18, true) | 0), height: Math.abs(readU32(bytes, 22, true) | 0) };
}

// The size a JPEG, PNG, GIF, WebP or BMP will decode to, read from its
// header, so a small file that declares a huge image is refused before it's
// decoded. Null for other formats, or a header that isn't there: their size
// is checked once they're decoded.
export function headerSize(format: string, bytes: Uint8Array): Size | null {
  if (format === "jpg") {
    const info = readJpeg(bytes);
    return info && { width: info.width, height: info.height };
  }
  if (format === "png") return pngSize(bytes);
  if (format === "gif") return gifSize(bytes);
  if (format === "webp") return webpSize(bytes);
  if (format === "bmp") return bmpSize(bytes);
  return null;
}

// --- Images to one PDF ---------------------------------------------------

// Formats whose images are photos, stored lossily or straight from a camera:
// an opaque one goes in as a JPEG at quality 92 rather than lossless pixels.
// A JPEG is decoded only when it can't go in as it is (CMYK, 12-bit...).
const PHOTO_FORMATS = new Set([
  "jpg", "jpeg", "jfif", "jif", "jps", "heic", "heif", "avif", "webp", "jxl", "jp2", "pcd", "sfw", "hdr", "exr",
  "arw", "cr2", "cr3", "crw", "dng", "nef", "orf", "raf", "rw2",
]);
export const PHOTO_QUALITY = 0.92;

// A lossless WebP (a VP8L image) keeps its pixels; a lossy one ("VP8 ") is a photo.
export function isLosslessWebp(bytes: Uint8Array): boolean {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (fourcc === "VP8L") return true;
    if (fourcc === "VP8 ") return false;
    offset += 8 + readU32(bytes, offset + 4, true) + (readU32(bytes, offset + 4, true) % 2);
  }
  return false;
}

export type ImagePdfDecoders = {
  // The image's pixels, 8-bit RGBA in sRGB.
  decode(format: string, buffer: ArrayBuffer): Promise<Pixels>;
  // For the formats only ImageMagick reads (MAGICK_BROWSER_INPUTS): the image
  // as a PNG, whose header is checked before `decode` reads it as "png".
  // Without it, `decode` reads those formats itself.
  magickToPng?(format: string, buffer: ArrayBuffer): Promise<ArrayBuffer>;
  // A JPEG of the pixels at `quality` (0 to 1).
  encodeJpeg(pixels: Pixels, quality: number): Promise<Uint8Array>;
};

// The site's engines: the browser's decoders (decode.ts, with libheif and
// the texture formats), and ImageMagick WASM through a PNG, as the
// single-format converters read them.
const browserDecoders: ImagePdfDecoders = {
  async decode(format, buffer) {
    const { decodeToRGBA } = await import("./decode.ts");
    return decodeToRGBA(format, buffer);
  },
  async magickToPng(format, buffer) {
    const { convertWithMagickInBrowser } = await import("./magickBrowser.ts");
    return (await convertWithMagickInBrowser(buffer, format, "png")).buffer;
  },
  async encodeJpeg(pixels, quality) {
    const { encodeFromRGBA } = await import("./encode.ts");
    const rgba = { data: new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.length), width: pixels.width, height: pixels.height };
    return new Uint8Array(await (await encodeFromRGBA("jpg", rgba, quality)).arrayBuffer());
  },
};

export type ImageFile = { name: string; arrayBuffer(): Promise<ArrayBuffer> };

// Why a PDF couldn't be made, in words for the visitor, with the telemetry
// code and metadata that getTelemetryFailure (lib/telemetry.ts) reads.
export type ImagePdfErrorCode =
  | "too_many_images"
  | "pdf_too_large"
  | "image_too_large"
  | "unsupported_input"
  | "convert_failed";

export class ImagePdfError extends Error {
  readonly telemetryCode: ImagePdfErrorCode;
  readonly telemetryMetadata: { engine: "image-pdf"; format?: string };

  constructor(message: string, code: ImagePdfErrorCode, format?: string) {
    super(message);
    this.name = "ImagePdfError";
    this.telemetryCode = code;
    this.telemetryMetadata = format ? { engine: "image-pdf", format } : { engine: "image-pdf" };
  }
}

// Refuses an image too large to decode and encode in a tab, by its name.
function checkPixels(file: ImageFile, format: string, size: Size | null) {
  if (!size || size.width * size.height <= IMAGE_PDF_MAX_PIXELS) return;
  throw new ImagePdfError(imageTooLargeMessage(file.name, size.width, size.height), "image_too_large", format);
}

async function addImage(
  pdf: ImagePdf,
  file: ImageFile,
  format: string,
  buffer: ArrayBuffer,
  decoders: ImagePdfDecoders,
) {
  const bytes = new Uint8Array(buffer);
  if (format === "jpg") {
    const info = readJpeg(bytes);
    const image = info && embedsAsIs(info) ? jpegImageData(bytes) : null;
    if (info && image) return pdf.addJpeg(image, info);
  }
  // From the header where it says (JPEG, PNG, GIF, WebP, BMP), so a small
  // file of a huge image isn't decoded at all; otherwise once it's decoded.
  checkPixels(file, format, headerSize(format, bytes));
  let source = buffer;
  let decodeAs = format;
  if (decoders.magickToPng && MAGICK_BROWSER_INPUTS.has(format)) {
    // ImageMagick has read the file to write this PNG; it isn't decoded
    // again when it's too large.
    source = await decoders.magickToPng(format, buffer);
    decodeAs = "png";
    checkPixels(file, format, headerSize("png", new Uint8Array(source)));
  }
  const pixels = await decoders.decode(decodeAs, source);
  checkPixels(file, format, pixels);
  const photo = PHOTO_FORMATS.has(format) && !(format === "webp" && isLosslessWebp(bytes));
  if (photo && isOpaque(pixels)) {
    const jpeg = await decoders.encodeJpeg(pixels, PHOTO_QUALITY);
    const info = readJpeg(jpeg);
    const image = info && embedsAsIs(info) ? jpegImageData(jpeg) : null;
    if (info && image) return pdf.addJpeg(image, { ...info, orientation: 1 });
  }
  return pdf.addPixels(pixels);
}

function isOpaque({ data }: Pixels): boolean {
  for (let index = 3; index < data.length; index += 4) if (data[index] !== 255) return false;
  return true;
}

// The images, one page each in the order given, as one PDF. Files are read
// one at a time, so only the image being added is held decoded.
export async function imagesToPdf(
  files: readonly ImageFile[],
  {
    decoders = browserDecoders,
    maxBytes = IMAGE_PDF_MAX_BYTES,
    onProgress,
  }: {
    decoders?: ImagePdfDecoders;
    maxBytes?: number;
    // Called as each image starts, and with `done === total` before saving.
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<Uint8Array> {
  if (!files.length) throw new ImagePdfError("Choose at least one image.", "unsupported_input");
  if (files.length > IMAGE_PDF_MAX_IMAGES) {
    throw new ImagePdfError(tooManyImagesMessage(files.length), "too_many_images");
  }
  const pdf = await createImagePdf();
  for (const [index, file] of files.entries()) {
    onProgress?.(index, files.length);
    const buffer = await file.arrayBuffer();
    const format = imageFormatOf(file.name, new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096)));
    if (!format) throw new ImagePdfError(`${file.name} isn't an image this page can read.`, "unsupported_input");
    try {
      await addImage(pdf, file, format, buffer, decoders);
    } catch (error) {
      if (error instanceof ImagePdfError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new ImagePdfError(`Couldn't read ${file.name}: ${reason}`, "convert_failed", format);
    }
    if (pdf.imageBytes > maxBytes) throw new ImagePdfError(pdfTooLargeMessage(index), "pdf_too_large", format);
  }
  onProgress?.(files.length, files.length);
  return pdf.save();
}

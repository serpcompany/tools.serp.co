// Image to PDF (image-to-pdf): images into one PDF, one page each, in the
// order given. As jpg-to-pdf, each page is its image's size, one point a
// pixel, and the image fills it. pdf-lib writes the document; each image goes
// in as one of:
//
// - A JPEG's own bytes (DCTDecode), so a photo is neither re-encoded nor
//   enlarged. Its EXIF orientation turns the page, as a browser shows it, and
//   its ICC profile (an iPhone's Display P3, say) is embedded with it.
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
  IMAGE_PDF_MAX_IMAGES,
  imageFormatOf,
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

// The channels at `offsets` of RGBA pixels, row by row. With `paeth`, each
// row is a PNG row filtered with Paeth, as a /Predictor 15 Flate stream holds
// it: a filter byte (4), then each byte's difference from the nearest of its
// left, upper and upper-left neighbours' sum. Without, the bytes as they are.
export function imageRows(
  data: ArrayLike<number>,
  width: number,
  height: number,
  offsets: readonly number[],
  paeth: boolean,
): Uint8Array<ArrayBuffer> {
  const rowBytes = width * offsets.length;
  const out = new Uint8Array(height * (rowBytes + (paeth ? 1 : 0)));
  const stride = width * 4;
  let at = 0;
  for (let y = 0; y < height; y += 1) {
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

// zlib, as a Flate stream holds it: the browser's own CompressionStream, or
// fflate where there's none (Safari before 16.4).
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (typeof CompressionStream === "function") {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { zlibSync } = await import("fflate");
  return zlibSync(bytes);
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
    const { data, width, height } = pixels;
    // Paeth halves a photo; a screenshot or drawing often compresses better
    // as it is. Both are tried, one at a time, and the smaller kept.
    const plain = await deflate(imageRows(data, width, height, offsets, false));
    const paeth = await deflate(imageRows(data, width, height, offsets, true));
    const predicted = paeth.byteLength < plain.byteLength;
    const compressed = predicted ? paeth : plain;
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
  // A JPEG of the pixels at `quality` (0 to 1).
  encodeJpeg(pixels: Pixels, quality: number): Promise<Uint8Array>;
};

// The site's engines: the browser's decoders (decode.ts, with libheif and
// the texture formats), and ImageMagick WASM through a PNG, as the
// single-format converters read them.
const browserDecoders: ImagePdfDecoders = {
  async decode(format, buffer) {
    const { decodeToRGBA } = await import("./decode.ts");
    if (MAGICK_BROWSER_INPUTS.has(format)) {
      const { convertWithMagickInBrowser } = await import("./magickBrowser.ts");
      const png = await convertWithMagickInBrowser(buffer, format, "png");
      return decodeToRGBA("png", png.buffer);
    }
    return decodeToRGBA(format, buffer);
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
export type ImagePdfErrorCode = "too_many_images" | "pdf_too_large" | "unsupported_input" | "convert_failed";

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

async function addImage(pdf: ImagePdf, format: string, buffer: ArrayBuffer, decoders: ImagePdfDecoders) {
  if (format === "jpg") {
    const bytes = new Uint8Array(buffer);
    const info = readJpeg(bytes);
    if (info && embedsAsIs(info)) return pdf.addJpeg(bytes, info);
  }
  const pixels = await decoders.decode(format, buffer);
  const photo = PHOTO_FORMATS.has(format) && !(format === "webp" && isLosslessWebp(new Uint8Array(buffer)));
  if (photo && isOpaque(pixels)) {
    const jpeg = await decoders.encodeJpeg(pixels, PHOTO_QUALITY);
    const info = readJpeg(jpeg);
    if (info && embedsAsIs(info)) return pdf.addJpeg(jpeg, { ...info, orientation: 1 });
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
      await addImage(pdf, format, buffer, decoders);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ImagePdfError(`Couldn't read ${file.name}: ${reason}`, "convert_failed", format);
    }
    if (pdf.imageBytes > maxBytes) throw new ImagePdfError(pdfTooLargeMessage(index), "pdf_too_large", format);
  }
  onProgress?.(files.length, files.length);
  return pdf.save();
}

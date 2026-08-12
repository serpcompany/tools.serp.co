import { PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

import { decodedAllocationExceeds } from '../tool-workflow/image-allocation-limits.ts';
import type { SemanticVerification } from '../tool-workflow/index.ts';

export const BMP_CONVERSION_TOOL_IDS = Object.freeze([
  'bmp-to-jpeg',
  'bmp-to-jpg',
  'bmp-to-pdf',
  'bmp-to-png',
  'bmp-to-webp',
] as const);

export const BMP_CONVERSION_TOOL_IDS_SHA256 =
  'sha256:e079eafef5b2221a25a123f5bb65d20f9cf95c81ed01b24426b328b345a2f99d';

export const BMP_ENGINE_CONTRACT = Object.freeze({
  decode: 'browser-platform-image-codec',
  encode: 'browser-canvas-codec',
  pdf: 'pdf-lib',
  fallback: 'fail-closed',
} as const);

export type BmpInspection =
  | Readonly<{
      status: 'verified';
      width: number;
      height: number;
      bitsPerPixel: 24;
      topDown: boolean;
      rgba: Uint8Array;
    }>
  | Readonly<{ status: 'rejected'; message: string }>;

function rejected(message: string): BmpInspection {
  return Object.freeze({ status: 'rejected', message });
}

/**
 * Strict semantic preflight for the bounded BMP family. This intentionally
 * accepts only uncompressed 24-bit Windows BITMAPINFOHEADER files. Browser
 * platform codecs still own production decoding; this independent parser owns
 * byte identity, allocation bounds, and the source-pixel verification oracle.
 */
export function inspectBmp(bytes: Uint8Array): BmpInspection {
  if (bytes.byteLength < 54) return rejected('BMP header is truncated');
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return rejected('BMP signature is invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredFileSize = view.getUint32(2, true);
  const reserved = view.getUint32(6, true);
  const pixelOffset = view.getUint32(10, true);
  const dibSize = view.getUint32(14, true);
  const width = view.getInt32(18, true);
  const signedHeight = view.getInt32(22, true);
  const planes = view.getUint16(26, true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  const declaredImageSize = view.getUint32(34, true);
  if (declaredFileSize !== bytes.byteLength || reserved !== 0) {
    return rejected('BMP file-size or reserved fields are invalid');
  }
  if (dibSize !== 40 || pixelOffset !== 14 + dibSize) {
    return rejected('BMP DIB header or pixel offset is unsupported');
  }
  if (
    width < 1 ||
    signedHeight === 0 ||
    signedHeight === -2_147_483_648 ||
    planes !== 1 ||
    bitsPerPixel !== 24 ||
    compression !== 0
  ) {
    return rejected('BMP must be uncompressed 24-bit RGB');
  }
  const height = Math.abs(signedHeight);
  if (decodedAllocationExceeds(width, height)) {
    return rejected('BMP decoded RGBA size exceeds the verification limit');
  }
  const unpaddedRowBytes = width * 3;
  const rowStride = Math.ceil(unpaddedRowBytes / 4) * 4;
  if (!Number.isSafeInteger(rowStride)) {
    return rejected('BMP row allocation is invalid');
  }
  const pixelBytes = rowStride * height;
  if (
    !Number.isSafeInteger(pixelBytes) ||
    pixelOffset + pixelBytes !== bytes.byteLength ||
    (declaredImageSize !== 0 && declaredImageSize !== pixelBytes)
  ) {
    return rejected('BMP pixel payload size is inconsistent');
  }

  const rgba = new Uint8Array(width * height * 4);
  const topDown = signedHeight < 0;
  for (let outputY = 0; outputY < height; outputY += 1) {
    const sourceY = topDown ? outputY : height - outputY - 1;
    const sourceRow = pixelOffset + sourceY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * 3;
      const target = (outputY * width + x) * 4;
      rgba[target] = bytes[source + 2]!;
      rgba[target + 1] = bytes[source + 1]!;
      rgba[target + 2] = bytes[source]!;
      rgba[target + 3] = 255;
    }
  }
  return Object.freeze({
    status: 'verified',
    width,
    height,
    bitsPerPixel: 24,
    topDown,
    rgba,
  });
}

type DecodedRaster = Readonly<{
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
}>;

type BmpConversionVerification = Readonly<{
  input: Uint8Array;
  output: Readonly<{ format: string; bytes: Uint8Array }>;
  decode?: (bytes: Uint8Array, signal?: AbortSignal) => Promise<DecodedRaster>;
  signal?: AbortSignal;
}>;

function pdfNumber(dict: PDFDict, key: string): number | undefined {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

async function verifyPdfOutput(
  bytes: Uint8Array,
  source: Extract<BmpInspection, { status: 'verified' }>,
  signal?: AbortSignal,
): Promise<SemanticVerification> {
  signal?.throwIfAborted();
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      parseSpeed: 0,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    signal?.throwIfAborted();
    if (document.getPageCount() !== 1) {
      return { status: 'rejected', message: 'BMP PDF must contain one page' };
    }
    const page = document.getPage(0);
    const size = page.getSize();
    if (
      Math.abs(size.width - source.width) > 0.01 ||
      Math.abs(size.height - source.height) > 0.01 ||
      decodedAllocationExceeds(Math.round(size.width), Math.round(size.height))
    ) {
      return {
        status: 'rejected',
        message: 'BMP PDF page dimensions do not preserve the source bounds',
      };
    }
    const resources = page.node.Resources();
    const xObjects = resources?.lookup(PDFName.of('XObject'), PDFDict);
    let matchingImage = false;
    for (const key of xObjects?.keys() ?? []) {
      const object = xObjects?.lookup(key);
      if (!object || !('dict' in object) || !(object.dict instanceof PDFDict)) {
        continue;
      }
      const subtype = object.dict.get(PDFName.of('Subtype'));
      if (
        subtype instanceof PDFName &&
        subtype.asString() === '/Image' &&
        pdfNumber(object.dict, 'Width') === source.width &&
        pdfNumber(object.dict, 'Height') === source.height
      ) {
        matchingImage = true;
      }
    }
    return matchingImage
      ? { status: 'verified' }
      : {
          status: 'rejected',
          message: 'BMP PDF has no source-sized image content',
        };
  } catch {
    signal?.throwIfAborted();
    return { status: 'rejected', message: 'BMP PDF parser rejected the file' };
  }
}

export async function verifyBmpConversionSemantics({
  input,
  output,
  decode,
  signal,
}: BmpConversionVerification): Promise<SemanticVerification> {
  signal?.throwIfAborted();
  const source = inspectBmp(input);
  if (source.status !== 'verified') return source;
  if (output.format === 'pdf') {
    return verifyPdfOutput(output.bytes, source, signal);
  }
  if (!['jpeg', 'jpg', 'png', 'webp'].includes(output.format)) {
    return { status: 'rejected', message: 'Unsupported BMP output family' };
  }
  if (!decode) {
    return {
      status: 'unavailable',
      message: 'Browser raster decoder is unavailable',
    };
  }
  try {
    const decoded = await decode(output.bytes, signal);
    signal?.throwIfAborted();
    if (
      decoded.width !== source.width ||
      decoded.height !== source.height ||
      decodedAllocationExceeds(decoded.width, decoded.height) ||
      decoded.rgba.byteLength !== source.rgba.byteLength
    ) {
      return {
        status: 'rejected',
        message: 'BMP output dimensions or allocation do not match the source',
      };
    }
    let absoluteError = 0;
    let comparedChannels = 0;
    for (let index = 0; index < source.rgba.byteLength; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        absoluteError += Math.abs(
          source.rgba[index + channel]! - decoded.rgba[index + channel]!,
        );
        comparedChannels += 1;
      }
    }
    const meanAbsoluteError = absoluteError / comparedChannels;
    const tolerance = output.format === 'png' ? 0 : 32;
    return meanAbsoluteError <= tolerance
      ? { status: 'verified' }
      : {
          status: 'rejected',
          message: `BMP output content exceeds ${tolerance} mean-channel error`,
        };
  } catch {
    signal?.throwIfAborted();
    return {
      status: 'rejected',
      message: 'Browser raster decoder rejected the BMP conversion output',
    };
  }
}

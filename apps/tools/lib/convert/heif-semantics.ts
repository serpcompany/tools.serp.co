import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';

import { decodedAllocationExceeds } from '../tool-workflow/image-allocation-limits.ts';
import type { SemanticVerification } from '../tool-workflow/index.ts';

const HEVC_HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
]);

export type DecodedHeifRaster = Readonly<{
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
}>;

export function inspectHeifContainer(bytes: Uint8Array): SemanticVerification {
  if (bytes.byteLength < 16) {
    return { status: 'rejected', message: 'HEIF file header is truncated' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0, false);
  const type = new TextDecoder('latin1').decode(bytes.subarray(4, 8));
  if (type !== 'ftyp' || boxSize < 16 || boxSize > bytes.byteLength) {
    return { status: 'rejected', message: 'HEIF ftyp box is invalid' };
  }
  const brands = [];
  for (let offset = 8; offset + 4 <= boxSize; offset += offset === 8 ? 8 : 4) {
    brands.push(
      new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 4)),
    );
  }
  if (!brands.some((brand) => HEVC_HEIF_BRANDS.has(brand))) {
    return {
      status: 'rejected',
      message: 'HEIF file does not declare a reviewed HEVC image brand',
    };
  }
  const topLevelBoxes = [];
  for (let offset = 0; offset < bytes.byteLength; ) {
    if (bytes.byteLength - offset < 8) {
      return {
        status: 'rejected',
        message: 'HEIF has trailing polyglot bytes',
      };
    }
    const size = view.getUint32(offset, false);
    const boxType = new TextDecoder('latin1').decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    if (size < 8 || size > bytes.byteLength - offset) {
      return { status: 'rejected', message: 'HEIF box bounds are invalid' };
    }
    topLevelBoxes.push(boxType);
    offset += size;
  }
  return topLevelBoxes[0] === 'ftyp' &&
    topLevelBoxes.includes('meta') &&
    topLevelBoxes.includes('mdat')
    ? { status: 'verified' }
    : { status: 'rejected', message: 'HEIF image boxes are incomplete' };
}

function pdfNumber(dict: PDFDict, key: string): number | undefined {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

function rgbFromRgba(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const rgb = new Uint8Array((rgba.byteLength / 4) * 3);
  for (let source = 0, target = 0; source < rgba.byteLength; source += 4) {
    rgb[target++] = rgba[source]!;
    rgb[target++] = rgba[source + 1]!;
    rgb[target++] = rgba[source + 2]!;
  }
  return rgb;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

async function verifyPdf(
  bytes: Uint8Array,
  source: DecodedHeifRaster,
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
      return { status: 'rejected', message: 'HEIF PDF must contain one page' };
    }
    const page = document.getPage(0);
    const size = page.getSize();
    if (
      Math.abs(size.width - source.width) > 0.01 ||
      Math.abs(size.height - source.height) > 0.01
    ) {
      return {
        status: 'rejected',
        message: 'HEIF PDF page dimensions do not match the source',
      };
    }
    const resources = page.node.Resources();
    const xObjects = resources?.get(PDFName.of('XObject'))
      ? resources.lookup(PDFName.of('XObject'), PDFDict)
      : undefined;
    const contents = page.node.Contents();
    const contentObjects = (
      contents instanceof PDFArray
        ? contents.asArray()
        : contents
          ? [contents]
          : []
    )
      .map((value) =>
        value instanceof PDFRef ? document.context.lookup(value) : value,
      )
      .filter((value): value is PDFRawStream => value instanceof PDFRawStream);
    if (contentObjects.length !== 1) {
      return {
        status: 'rejected',
        message: 'HEIF PDF must have one bounded content stream',
      };
    }
    const content = contentObjects[0];
    if (!content) {
      return {
        status: 'rejected',
        message: 'HEIF PDF content stream is missing',
      };
    }
    const operators = new TextDecoder()
      .decode(decodePDFRawStream(content).decode())
      .trim();
    const expectedRgb = rgbFromRgba(source.rgba);
    let matchingImages = 0;
    for (const key of xObjects?.keys() ?? []) {
      const object = xObjects?.lookup(key);
      if (!(object instanceof PDFRawStream)) continue;
      if (
        object.dict.get(PDFName.of('Subtype')) instanceof PDFName &&
        pdfNumber(object.dict, 'Width') === source.width &&
        pdfNumber(object.dict, 'Height') === source.height &&
        bytesEqual(decodePDFRawStream(object).decode(), expectedRgb) &&
        operators.includes(`/${key.decodeText()} Do`)
      ) {
        matchingImages += 1;
      }
    }
    return matchingImages === 1
      ? { status: 'verified' }
      : {
          status: 'rejected',
          message: 'HEIF PDF has no exact source-sized image content',
        };
  } catch {
    signal?.throwIfAborted();
    return { status: 'rejected', message: 'HEIF PDF parser rejected the file' };
  }
}

export async function verifyHeifConversionSemantics(
  options: Readonly<{
    input: Uint8Array;
    output: Readonly<{ format: string; bytes: Uint8Array }>;
    decodeInput: (
      bytes: Uint8Array,
      signal?: AbortSignal,
    ) => Promise<DecodedHeifRaster>;
    decodeOutput?: (
      bytes: Uint8Array,
      signal?: AbortSignal,
    ) => Promise<DecodedHeifRaster>;
    signal?: AbortSignal;
  }>,
): Promise<SemanticVerification> {
  options.signal?.throwIfAborted();
  const identity = inspectHeifContainer(options.input);
  if (identity.status !== 'verified') return identity;
  let source: DecodedHeifRaster;
  try {
    source = await options.decodeInput(options.input, options.signal);
  } catch {
    options.signal?.throwIfAborted();
    return { status: 'rejected', message: 'HEIF decoder rejected the input' };
  }
  if (
    decodedAllocationExceeds(source.width, source.height) ||
    source.rgba.byteLength !== source.width * source.height * 4
  ) {
    return {
      status: 'rejected',
      message: 'HEIF decoded source allocation is inconsistent',
    };
  }
  if (options.output.format === 'pdf') {
    return verifyPdf(options.output.bytes, source, options.signal);
  }
  if (!['jpeg', 'jpg', 'png', 'webp'].includes(options.output.format)) {
    return { status: 'rejected', message: 'Unsupported HEIF output family' };
  }
  if (!options.decodeOutput) {
    return {
      status: 'unavailable',
      message: 'Browser raster decoder is unavailable',
    };
  }
  try {
    const output = await options.decodeOutput(
      options.output.bytes,
      options.signal,
    );
    options.signal?.throwIfAborted();
    if (
      output.width !== source.width ||
      output.height !== source.height ||
      output.rgba.byteLength !== source.rgba.byteLength
    ) {
      return {
        status: 'rejected',
        message: 'HEIF output dimensions do not match the source',
      };
    }
    let absoluteError = 0;
    let channels = 0;
    for (let index = 0; index < source.rgba.byteLength; index += 4) {
      if (source.rgba[index + 3] !== output.rgba[index + 3]) {
        return { status: 'rejected', message: 'HEIF output opacity changed' };
      }
      for (let channel = 0; channel < 3; channel += 1) {
        absoluteError += Math.abs(
          source.rgba[index + channel]! - output.rgba[index + channel]!,
        );
        channels += 1;
      }
    }
    const tolerance = options.output.format === 'png' ? 0 : 32;
    return absoluteError / channels <= tolerance
      ? { status: 'verified' }
      : {
          status: 'rejected',
          message: `HEIF output content exceeds ${tolerance} mean-channel error`,
        };
  } catch {
    options.signal?.throwIfAborted();
    return {
      status: 'rejected',
      message: 'Browser raster decoder rejected the HEIF output',
    };
  }
}

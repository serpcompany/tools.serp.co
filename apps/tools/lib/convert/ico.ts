export const ICO_TO_PNG_TOOL_IDS = Object.freeze(['ico-to-png'] as const);
export type IcoToPngToolId = (typeof ICO_TO_PNG_TOOL_IDS)[number];
export const ICO_TO_PNG_CANDIDATE_CONTRACT = Object.freeze({
  state: 'supported',
  toolId: 'ico-to-png',
  adapterId: 'generic-conversion',
  operation: 'convert',
  input: { format: 'ico', mimeType: 'image/x-icon' },
  output: { format: 'png', mimeType: 'image/png' },
} as const);

export const ICO_TO_PNG_LIMITS = Object.freeze({
  maxInputBytes: 16 * 1_024 * 1_024,
  maxEntries: 64,
  maxDimension: 256,
  maxDecodedRgbaBytes: 16 * 1_024 * 1_024,
  maxOutputBytes: 4 * 1_024 * 1_024,
  executionTimeoutMs: 10_000,
});

type IcoEntry = Readonly<{
  index: number;
  width: number;
  height: number;
  directoryBpp: number;
  payloadOffset: number;
  payloadBytes: number;
  sourceKind: 'dib' | 'png';
}>;

export type DecodedIcoImage = Readonly<{
  width: number;
  height: number;
  bpp: number;
  png: Uint8Array;
}>;

export type IcoDecoder = Readonly<{
  decode(bytes: Uint8Array): Promise<readonly DecodedIcoImage[]>;
}>;

export type IcoConversionResult = Readonly<{
  png: Uint8Array;
  width: number;
  height: number;
  selectedIndex: number;
  sourceKind: 'dib' | 'png';
  sourceBytes: Uint8Array;
}>;

export type IcoVerifiedWorkerResult = Readonly<
  Omit<IcoConversionResult, 'sourceBytes'> & { pixelVerified: true }
>;

export type IcoPngDecoder = (bytes: Uint8Array) => Promise<
  Readonly<{
    width: number;
    height: number;
    rgba: Uint8Array | Uint8ClampedArray;
  }>
>;

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

function isPng(bytes: Uint8Array, offset: number): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[offset + index] === byte);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function checkedDecodedBytes(width: number, height: number): number {
  const pixels = width * height;
  if (
    !Number.isSafeInteger(pixels) ||
    width < 1 ||
    height < 1 ||
    width > ICO_TO_PNG_LIMITS.maxDimension ||
    height > ICO_TO_PNG_LIMITS.maxDimension
  ) {
    throw new Error('ICO entry dimensions exceed the supported limit.');
  }
  return pixels * 4;
}

export function hasIcoIdentity(bytes: Uint8Array): boolean {
  if (
    bytes.byteLength < 6 ||
    bytes.byteLength > ICO_TO_PNG_LIMITS.maxInputBytes
  ) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  return (
    view.getUint16(0, true) === 0 &&
    view.getUint16(2, true) === 1 &&
    count >= 1 &&
    count <= ICO_TO_PNG_LIMITS.maxEntries
  );
}

function inspectPngPayload(
  bytes: Uint8Array,
  entry: Omit<IcoEntry, 'sourceKind'>,
  label = 'ICO PNG entry',
): void {
  if (entry.payloadBytes < 33 || !isPng(bytes, entry.payloadOffset)) {
    throw new Error(`${label} is malformed.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payloadEnd = entry.payloadOffset + entry.payloadBytes;
  let offset = entry.payloadOffset + PNG_SIGNATURE.length;
  let chunkCount = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < payloadEnd) {
    if (payloadEnd - offset < 12 || chunkCount >= 4_096) {
      throw new Error(`${label} is truncated or too complex.`);
    }
    const length = view.getUint32(offset, false);
    const chunkEnd = offset + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > payloadEnd) {
      throw new Error(`${label} chunk is truncated.`);
    }
    const type = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    const storedCrc = view.getUint32(offset + 8 + length, false);
    const computedCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (storedCrc !== computedCrc) {
      throw new Error(`${label} ${type} chunk has an invalid CRC.`);
    }
    if (chunkCount === 0) {
      const width = view.getUint32(offset + 8, false);
      const height = view.getUint32(offset + 12, false);
      const bitDepth = bytes[offset + 16]!;
      const colorType = bytes[offset + 17]!;
      const channels = new Map([
        [0, 1],
        [2, 3],
        [3, 1],
        [4, 2],
        [6, 4],
      ]).get(colorType);
      const legalDepth =
        channels !== undefined &&
        (colorType === 0
          ? [1, 2, 4, 8, 16].includes(bitDepth)
          : colorType === 3
            ? [1, 2, 4, 8].includes(bitDepth)
            : [8, 16].includes(bitDepth));
      if (
        type !== 'IHDR' ||
        length !== 13 ||
        width !== entry.width ||
        height !== entry.height ||
        !legalDepth ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        ![0, 1].includes(bytes[offset + 20]!)
      ) {
        throw new Error(`${label} metadata disagrees with its directory.`);
      }
      sawHeader = true;
    } else if (type === 'IHDR') {
      throw new Error(`${label} contains a duplicate IHDR chunk.`);
    }
    if (type === 'IDAT') {
      if (!sawHeader || sawEnd) {
        throw new Error(`${label} has image data outside the PNG image.`);
      }
      sawImageData = true;
    }
    if (type === 'IEND') {
      if (length !== 0 || chunkEnd !== payloadEnd) {
        throw new Error(`${label} IEND chunk must terminate the image.`);
      }
      sawEnd = true;
    }
    offset = chunkEnd;
    chunkCount += 1;
  }
  if (!sawImageData || !sawEnd) {
    throw new Error(`${label} requires image data and a terminal IEND.`);
  }
}

function inspectDibPayload(
  bytes: Uint8Array,
  entry: Omit<IcoEntry, 'sourceKind'>,
): void {
  if (entry.payloadBytes < 40) throw new Error('ICO DIB entry is truncated.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerBytes = view.getUint32(entry.payloadOffset, true);
  if (
    ![40, 108, 124].includes(headerBytes) ||
    headerBytes > entry.payloadBytes
  ) {
    throw new Error('ICO DIB header is unsupported.');
  }
  const width = view.getInt32(entry.payloadOffset + 4, true);
  const doubledHeight = view.getInt32(entry.payloadOffset + 8, true);
  const planes = view.getUint16(entry.payloadOffset + 12, true);
  const bpp = view.getUint16(entry.payloadOffset + 14, true);
  const compression = view.getUint32(entry.payloadOffset + 16, true);
  if (
    width !== entry.width ||
    doubledHeight !== entry.height * 2 ||
    planes !== 1 ||
    ![1, 4, 8, 24, 32].includes(bpp) ||
    compression !== 0 ||
    (entry.directoryBpp !== 0 && entry.directoryBpp !== bpp)
  ) {
    throw new Error('ICO DIB entry metadata is unsupported or inconsistent.');
  }
  const colorsUsed = view.getUint32(entry.payloadOffset + 32, true);
  const paletteEntries =
    bpp <= 8 ? (colorsUsed === 0 ? 2 ** bpp : colorsUsed) : 0;
  if (paletteEntries > 256) {
    throw new Error('ICO DIB palette exceeds the supported limit.');
  }
  const xorRowBytes = Math.ceil((entry.width * bpp) / 32) * 4;
  const andRowBytes = Math.ceil(entry.width / 32) * 4;
  const requiredBytes =
    headerBytes +
    paletteEntries * 4 +
    xorRowBytes * entry.height +
    andRowBytes * entry.height;
  if (
    !Number.isSafeInteger(requiredBytes) ||
    requiredBytes > entry.payloadBytes
  ) {
    throw new Error('ICO DIB pixel payload is truncated.');
  }
}

export function inspectIco(bytes: Uint8Array): readonly IcoEntry[] {
  if (bytes.byteLength > ICO_TO_PNG_LIMITS.maxInputBytes) {
    throw new Error('ICO input exceeds the supported limit.');
  }
  if (bytes.byteLength < 6) throw new Error('ICO header is truncated.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) {
    throw new Error('Input is not an ICO resource.');
  }
  const count = view.getUint16(4, true);
  if (count < 1 || count > ICO_TO_PNG_LIMITS.maxEntries) {
    throw new Error('ICO entry count exceeds the supported limit.');
  }
  const directoryEnd = 6 + count * 16;
  if (directoryEnd > bytes.byteLength)
    throw new Error('ICO directory is truncated.');
  const ranges: Array<Readonly<{ start: number; end: number }>> = [];
  const entries: IcoEntry[] = [];
  let aggregateDecodedBytes = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = bytes[offset] === 0 ? 256 : bytes[offset]!;
    const height = bytes[offset + 1] === 0 ? 256 : bytes[offset + 1]!;
    const directoryBpp = view.getUint16(offset + 6, true);
    const payloadBytes = view.getUint32(offset + 8, true);
    const payloadOffset = view.getUint32(offset + 12, true);
    const payloadEnd = payloadOffset + payloadBytes;
    aggregateDecodedBytes += checkedDecodedBytes(width, height);
    if (
      payloadBytes === 0 ||
      payloadOffset < directoryEnd ||
      !Number.isSafeInteger(payloadEnd) ||
      payloadEnd > bytes.byteLength ||
      ranges.some(
        (range) => payloadOffset < range.end && payloadEnd > range.start,
      )
    ) {
      throw new Error('ICO entry payload range is invalid or overlapping.');
    }
    ranges.push({ start: payloadOffset, end: payloadEnd });
    const partial = {
      index,
      width,
      height,
      directoryBpp,
      payloadOffset,
      payloadBytes,
    };
    const sourceKind = isPng(bytes, payloadOffset) ? 'png' : 'dib';
    if (sourceKind === 'png') inspectPngPayload(bytes, partial);
    else inspectDibPayload(bytes, partial);
    entries.push(Object.freeze({ ...partial, sourceKind }));
  }
  if (aggregateDecodedBytes > ICO_TO_PNG_LIMITS.maxDecodedRgbaBytes) {
    throw new Error('ICO aggregate decoded pixels exceed the supported limit.');
  }
  return Object.freeze(entries);
}

export async function convertIcoBytesToPng(
  bytes: Uint8Array,
  decoder: IcoDecoder,
): Promise<IcoConversionResult> {
  const entries = inspectIco(bytes);
  const decoded = await decoder.decode(bytes);
  if (decoded.length !== entries.length) {
    throw new Error('ICO decoder returned an inconsistent entry count.');
  }
  for (const [index, image] of decoded.entries()) {
    const entry = entries[index]!;
    if (
      image.width !== entry.width ||
      image.height !== entry.height ||
      !Number.isSafeInteger(image.bpp) ||
      image.bpp < 1 ||
      image.png.byteLength < PNG_SIGNATURE.length ||
      image.png.byteLength > ICO_TO_PNG_LIMITS.maxOutputBytes ||
      !isPng(image.png, 0)
    ) {
      throw new Error('ICO decoder returned inconsistent image data.');
    }
    inspectPngPayload(
      image.png,
      {
        index,
        width: image.width,
        height: image.height,
        directoryBpp: image.bpp,
        payloadOffset: 0,
        payloadBytes: image.png.byteLength,
      },
      'ICO decoder PNG output',
    );
  }
  const selected = decoded.reduce(
    (best, candidate, index) => {
      const bestArea = best.image.width * best.image.height;
      const candidateArea = candidate.width * candidate.height;
      return candidateArea > bestArea ||
        (candidateArea === bestArea && candidate.bpp > best.image.bpp)
        ? { image: candidate, index }
        : best;
    },
    { image: decoded[0]!, index: 0 },
  );
  const entry = entries[selected.index]!;
  return Object.freeze({
    png: Uint8Array.from(selected.image.png),
    width: entry.width,
    height: entry.height,
    selectedIndex: entry.index,
    sourceKind: entry.sourceKind,
    sourceBytes: bytes.slice(
      entry.payloadOffset,
      entry.payloadOffset + entry.payloadBytes,
    ),
  });
}

export function decodeIcoDibToRgba(
  bytes: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  checkedDecodedBytes(width, height);
  if (bytes.byteLength < 40) throw new Error('ICO DIB entry is truncated.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerBytes = view.getUint32(0, true);
  const dibWidth = view.getInt32(4, true);
  const doubledHeight = view.getInt32(8, true);
  const planes = view.getUint16(12, true);
  const bpp = view.getUint16(14, true);
  const compression = view.getUint32(16, true);
  const colorsUsed = view.getUint32(32, true);
  if (
    ![40, 108, 124].includes(headerBytes) ||
    dibWidth !== width ||
    doubledHeight !== height * 2 ||
    planes !== 1 ||
    ![1, 4, 8, 24, 32].includes(bpp) ||
    compression !== 0
  ) {
    throw new Error('ICO DIB entry metadata is unsupported or inconsistent.');
  }
  const paletteEntries =
    bpp <= 8 ? (colorsUsed === 0 ? 2 ** bpp : colorsUsed) : 0;
  const paletteOffset = headerBytes;
  const xorOffset = paletteOffset + paletteEntries * 4;
  const xorRowBytes = Math.ceil((width * bpp) / 32) * 4;
  const andOffset = xorOffset + xorRowBytes * height;
  const andRowBytes = Math.ceil(width / 32) * 4;
  if (andOffset + andRowBytes * height > bytes.byteLength) {
    throw new Error('ICO DIB pixel payload is truncated.');
  }
  const rgba = new Uint8Array(width * height * 4);
  let hasExplicitAlpha = false;
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    const xorRow = xorOffset + sourceY * xorRowBytes;
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      if (bpp <= 8) {
        const packed = bytes[xorRow + Math.floor((x * bpp) / 8)]!;
        const shift = 8 - bpp - ((x * bpp) % 8);
        const paletteIndex = (packed >> shift) & (2 ** bpp - 1);
        const palette = paletteOffset + paletteIndex * 4;
        rgba[target] = bytes[palette + 2]!;
        rgba[target + 1] = bytes[palette + 1]!;
        rgba[target + 2] = bytes[palette]!;
        rgba[target + 3] = 255;
      } else {
        const pixel = xorRow + x * (bpp / 8);
        rgba[target] = bytes[pixel + 2]!;
        rgba[target + 1] = bytes[pixel + 1]!;
        rgba[target + 2] = bytes[pixel]!;
        rgba[target + 3] = bpp === 32 ? bytes[pixel + 3]! : 255;
        if (rgba[target + 3] !== 0) hasExplicitAlpha = true;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    const maskRow = andOffset + sourceY * andRowBytes;
    for (let x = 0; x < width; x += 1) {
      const transparent =
        ((bytes[maskRow + Math.floor(x / 8)]! >> (7 - (x % 8))) & 1) === 1;
      const alpha = (y * width + x) * 4 + 3;
      if (transparent) rgba[alpha] = 0;
      else if (bpp !== 32 || !hasExplicitAlpha) rgba[alpha] = 255;
    }
  }
  return rgba;
}

export function verifyIcoDecodedOutput(args: {
  expected: Readonly<{
    width: number;
    height: number;
    rgba: Uint8Array | Uint8ClampedArray;
  }>;
  actual: Readonly<{
    width: number;
    height: number;
    rgba: Uint8Array | Uint8ClampedArray;
  }>;
}): void {
  if (
    args.actual.width !== args.expected.width ||
    args.actual.height !== args.expected.height
  ) {
    throw new Error(
      'Delivered PNG dimensions differ from the selected ICO image.',
    );
  }
  if (
    args.actual.rgba.byteLength !== args.expected.rgba.byteLength ||
    args.actual.rgba.some((value, index) => value !== args.expected.rgba[index])
  ) {
    throw new Error('Delivered PNG pixels differ from the selected ICO image.');
  }
}

export async function verifyIcoConversionResult(
  result: IcoConversionResult,
  decodePng: IcoPngDecoder,
): Promise<void> {
  const [actual, pngSource] = await Promise.all([
    decodePng(result.png),
    result.sourceKind === 'png' ? decodePng(result.sourceBytes) : undefined,
  ]);
  const expected =
    result.sourceKind === 'png'
      ? pngSource!
      : {
          width: result.width,
          height: result.height,
          rgba: decodeIcoDibToRgba(
            result.sourceBytes,
            result.width,
            result.height,
          ),
        };
  verifyIcoDecodedOutput({ expected, actual });
}

type IcoWorkerResponse = Readonly<{
  type?: 'progress';
  stage?: 'decode' | 'select' | 'verify';
  ok?: boolean;
  error?: string;
  png?: ArrayBuffer;
  width?: number;
  height?: number;
  selectedIndex?: number;
  sourceKind?: 'dib' | 'png';
  pixelVerified?: true;
}>;

export async function convertIcoToPngWithWorker(args: {
  worker: Worker;
  bytes: Uint8Array;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStage?: (stage: 'decode' | 'select' | 'verify') => void;
}): Promise<IcoVerifiedWorkerResult> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      args.signal?.removeEventListener('abort', abort);
      args.worker.onmessage = null;
      args.worker.onerror = null;
      callback();
    };
    const stop = (reason: unknown) => {
      args.worker.terminate();
      finish(() => reject(reason));
    };
    const abort = () =>
      stop(
        args.signal?.reason ??
          new DOMException('The operation was aborted', 'AbortError'),
      );
    const timeout = setTimeout(
      () => stop(new Error('ICO conversion exceeded its execution timeout.')),
      args.timeoutMs ?? ICO_TO_PNG_LIMITS.executionTimeoutMs,
    );
    if (args.signal?.aborted) {
      abort();
      return;
    }
    args.signal?.addEventListener('abort', abort, { once: true });
    args.worker.onerror = () =>
      stop(new Error('ICO conversion Worker failed.'));
    args.worker.onmessage = (event: MessageEvent<IcoWorkerResponse>) => {
      const result = event.data;
      if (result?.type === 'progress' && result.stage) {
        args.onStage?.(result.stage);
        return;
      }
      if (
        !result?.ok ||
        !(result.png instanceof ArrayBuffer) ||
        !Number.isSafeInteger(result.width) ||
        !Number.isSafeInteger(result.height) ||
        !Number.isSafeInteger(result.selectedIndex) ||
        (result.sourceKind !== 'dib' && result.sourceKind !== 'png') ||
        result.pixelVerified !== true
      ) {
        return finish(() =>
          reject(new Error(result?.error || 'Malformed ICO Worker response.')),
        );
      }
      const png = new Uint8Array(result.png);
      if (png.byteLength > ICO_TO_PNG_LIMITS.maxOutputBytes) {
        return finish(() => reject(new Error('PNG output exceeds the limit.')));
      }
      finish(() =>
        resolve(
          Object.freeze({
            png,
            width: result.width!,
            height: result.height!,
            selectedIndex: result.selectedIndex!,
            sourceKind: result.sourceKind!,
            pixelVerified: true,
          }),
        ),
      );
    };
    const input = Uint8Array.from(args.bytes).buffer;
    args.worker.postMessage({ type: 'convert-ico-to-png', input }, [input]);
  });
}

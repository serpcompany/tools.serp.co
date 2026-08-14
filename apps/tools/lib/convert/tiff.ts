import { isTiffToPngToolId, TIFF_TO_PNG_TOOL_IDS } from './tiff-family.mjs';

export { isTiffToPngToolId, TIFF_TO_PNG_TOOL_IDS };
export type TiffToolId = (typeof TIFF_TO_PNG_TOOL_IDS)[number];

export const TIFF_TO_PNG_LIMITS = Object.freeze({
  maxInputBytes: 32 * 1_024 * 1_024,
  maxDimension: 16_384,
  maxDecodedRgbaBytes: 64 * 1_024 * 1_024,
  maxOutputBytes: 64 * 1_024 * 1_024,
  maxStorageSegments: 65_536,
  executionTimeoutMs: 10_000,
});

export type TiffHeader = Readonly<{
  byteOrder: 'big' | 'little';
  firstIfdOffset: number;
}>;

export type TiffImageMetadata = Readonly<{
  width: number;
  height: number;
  bitsPerSample: readonly number[];
  sampleFormat: readonly number[];
  samplesPerPixel: number;
  imageCount: number;
  photometricInterpretation: number;
  extraSamples: readonly number[];
}>;

export function validateTiffImageMetadata(metadata: TiffImageMetadata) {
  if (metadata.imageCount !== 1) {
    throw new Error('TIFF to PNG requires a single image.');
  }
  if (
    !Number.isSafeInteger(metadata.width) ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.width < 1 ||
    metadata.height < 1 ||
    metadata.width > TIFF_TO_PNG_LIMITS.maxDimension ||
    metadata.height > TIFF_TO_PNG_LIMITS.maxDimension
  ) {
    throw new Error('TIFF dimensions exceed the supported limit.');
  }
  const rgbaBytes = metadata.width * metadata.height * 4;
  if (
    !Number.isSafeInteger(rgbaBytes) ||
    rgbaBytes > TIFF_TO_PNG_LIMITS.maxDecodedRgbaBytes
  ) {
    throw new Error('TIFF decoded pixels exceed the memory limit.');
  }
  const scanlineBytes = rgbaBytes + metadata.height;
  const pngUpperBound =
    scanlineBytes + Math.ceil(scanlineBytes / 65_535) * 5 + 128;
  if (
    !Number.isSafeInteger(pngUpperBound) ||
    pngUpperBound > TIFF_TO_PNG_LIMITS.maxOutputBytes
  ) {
    throw new Error('TIFF encoded PNG could exceed the output limit.');
  }
  if (
    ![1, 3, 4].includes(metadata.samplesPerPixel) ||
    metadata.bitsPerSample.length !== metadata.samplesPerPixel ||
    metadata.sampleFormat.length !== metadata.samplesPerPixel ||
    metadata.bitsPerSample.some((value) => value !== 8) ||
    metadata.sampleFormat.some((value) => value !== 1)
  ) {
    throw new Error('TIFF sample layout is unsupported.');
  }
  if (![0, 1, 2, 3].includes(metadata.photometricInterpretation)) {
    throw new Error('TIFF photometric interpretation is unsupported.');
  }
  const samplesMatchPhotometric =
    ([0, 1, 3].includes(metadata.photometricInterpretation) &&
      metadata.samplesPerPixel === 1) ||
    (metadata.photometricInterpretation === 2 &&
      [3, 4].includes(metadata.samplesPerPixel));
  if (!samplesMatchPhotometric) {
    throw new Error('TIFF photometric and sample layouts are inconsistent.');
  }
  if (metadata.samplesPerPixel === 4) {
    if (metadata.extraSamples.length !== 1 || metadata.extraSamples[0] !== 2) {
      throw new Error(
        'TIFF associated alpha is unsupported; one unpremultiplied alpha sample is required.',
      );
    }
  } else if (metadata.extraSamples.length !== 0) {
    throw new Error(
      'TIFF ExtraSamples are inconsistent with the sample layout.',
    );
  }
  return Object.freeze({
    width: metadata.width,
    height: metadata.height,
    rgbaBytes,
    pngUpperBound,
  });
}

export function normalizeTiffRgb(
  rgb: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const pixels = width * height;
  if (rgb.byteLength === pixels * 4) return Uint8Array.from(rgb);
  if (rgb.byteLength !== pixels * 3) {
    throw new Error('TIFF decoded RGB length is inconsistent.');
  }
  const rgba = new Uint8Array(pixels * 4);
  for (let source = 0, target = 0; source < rgb.length; source += 3) {
    rgba[target++] = rgb[source]!;
    rgba[target++] = rgb[source + 1]!;
    rgba[target++] = rgb[source + 2]!;
    rgba[target++] = 255;
  }
  return rgba;
}

function numericSamples(
  value: number | ArrayLike<number> | undefined,
  count: number,
  fallback: number,
): number[] {
  const values =
    value === undefined
      ? [fallback]
      : typeof value === 'number'
        ? [value]
        : Array.from(value);
  return Array.from({ length: count }, (_, index) =>
    Number(values[index] ?? values[0] ?? fallback),
  );
}

export async function decodeTiffToRgba(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Readonly<{ width: number; height: number; rgba: Uint8Array }>> {
  signal?.throwIfAborted();
  if (bytes.byteLength > TIFF_TO_PNG_LIMITS.maxInputBytes) {
    throw new Error('TIFF input exceeds the supported limit.');
  }
  inspectTiffHeader(bytes);
  const { fromArrayBuffer } = await import('geotiff');
  signal?.throwIfAborted();
  const tiff = await fromArrayBuffer(Uint8Array.from(bytes).buffer, signal);
  const imageCount = await tiff.getImageCount();
  const image = await tiff.getImage(0);
  const fileDirectory = image.getFileDirectory();
  const samplesPerPixel = image.getSamplesPerPixel();
  const photometricInterpretation = fileDirectory.getValue(
    'PhotometricInterpretation',
  );
  const extraSamples = fileDirectory.getValue('ExtraSamples');
  const metadata = validateTiffImageMetadata({
    width: image.getWidth(),
    height: image.getHeight(),
    bitsPerSample: numericSamples(
      fileDirectory.getValue('BitsPerSample'),
      samplesPerPixel,
      1,
    ),
    sampleFormat: numericSamples(
      fileDirectory.getValue('SampleFormat'),
      samplesPerPixel,
      1,
    ),
    samplesPerPixel,
    imageCount,
    photometricInterpretation: Number(photometricInterpretation ?? -1),
    extraSamples: Array.from(extraSamples ?? [], Number),
  });
  signal?.throwIfAborted();
  const rgb = await image.readRGB({
    interleave: true,
    enableAlpha: samplesPerPixel === 4,
    pool: null,
    signal,
  });
  signal?.throwIfAborted();
  if (!(rgb instanceof Uint8Array)) {
    throw new Error('TIFF decoder returned an unsupported sample array.');
  }
  const rgba = normalizeTiffRgb(rgb, metadata.width, metadata.height);
  if (rgba.byteLength !== metadata.rgbaBytes) {
    throw new Error('TIFF decoded pixels are inconsistent.');
  }
  return Object.freeze({
    width: metadata.width,
    height: metadata.height,
    rgba,
  });
}

export async function convertTiffBytesToPng(
  bytes: Uint8Array,
  signal?: AbortSignal,
  onStage?: (stage: 'decode' | 'encode' | 'verify') => void,
) {
  onStage?.('decode');
  const decoded = await decodeTiffToRgba(bytes, signal);
  signal?.throwIfAborted();
  onStage?.('encode');
  const { default: UPNG } = (await import('upng-js')) as {
    default: {
      encode(
        buffers: ArrayBuffer[],
        width: number,
        height: number,
        colors: number,
      ): ArrayBuffer;
    };
  };
  const encoded = UPNG.encode(
    [decoded.rgba.slice().buffer],
    decoded.width,
    decoded.height,
    0,
  );
  signal?.throwIfAborted();
  const png = new Uint8Array(encoded);
  if (
    png.byteLength > TIFF_TO_PNG_LIMITS.maxOutputBytes ||
    ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => png[index] === value,
    )
  ) {
    throw new Error('TIFF PNG encoder returned invalid or oversized output.');
  }
  onStage?.('verify');
  return Object.freeze({
    png,
    width: decoded.width,
    height: decoded.height,
    sourceRgbaSha256: await sha256Hex(decoded.rgba),
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

export async function verifyTiffDecodedOutput(args: {
  expected: Readonly<{
    width: number;
    height: number;
    sourceRgbaSha256: string;
  }>;
  actual: Readonly<{
    width: number;
    height: number;
    rgba: Uint8Array | Uint8ClampedArray;
  }>;
}): Promise<void> {
  if (
    args.actual.width !== args.expected.width ||
    args.actual.height !== args.expected.height
  ) {
    throw new Error('Delivered PNG dimensions differ from the TIFF source.');
  }
  const expectedBytes = args.actual.width * args.actual.height * 4;
  if (
    args.actual.rgba.byteLength !== expectedBytes ||
    (await sha256Hex(Uint8Array.from(args.actual.rgba))) !==
      args.expected.sourceRgbaSha256
  ) {
    throw new Error('Delivered PNG pixels differ from the TIFF source.');
  }
}

type TiffWorkerResponse = Readonly<{
  type?: 'progress';
  stage?: 'decode' | 'encode' | 'verify';
  ok?: boolean;
  error?: string;
  png?: ArrayBuffer;
  width?: number;
  height?: number;
  sourceRgbaSha256?: string;
}>;

export async function convertTiffToPngWithWorker(args: {
  worker: Worker;
  bytes: Uint8Array;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStage?: (stage: 'decode' | 'encode' | 'verify') => void;
}): Promise<
  Readonly<{
    png: Uint8Array;
    width: number;
    height: number;
    sourceRgbaSha256: string;
  }>
> {
  inspectTiffHeader(args.bytes);
  if (args.bytes.byteLength > TIFF_TO_PNG_LIMITS.maxInputBytes) {
    throw new Error('TIFF input exceeds the supported limit.');
  }
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
      () => stop(new Error('TIFF conversion exceeded its execution timeout.')),
      args.timeoutMs ?? TIFF_TO_PNG_LIMITS.executionTimeoutMs,
    );
    if (args.signal?.aborted) {
      abort();
      return;
    }
    args.signal?.addEventListener('abort', abort, { once: true });
    args.worker.onerror = () =>
      stop(new Error('TIFF conversion Worker failed.'));
    args.worker.onmessage = (event: MessageEvent<TiffWorkerResponse>) => {
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
        typeof result.sourceRgbaSha256 !== 'string'
      ) {
        return finish(() =>
          reject(new Error(result?.error || 'Malformed TIFF Worker response.')),
        );
      }
      if (result.png.byteLength > TIFF_TO_PNG_LIMITS.maxOutputBytes) {
        return finish(() => reject(new Error('PNG output exceeds the limit.')));
      }
      finish(() =>
        resolve(
          Object.freeze({
            png: new Uint8Array(result.png!),
            width: result.width!,
            height: result.height!,
            sourceRgbaSha256: result.sourceRgbaSha256!,
          }),
        ),
      );
    };
    const input = Uint8Array.from(args.bytes).buffer;
    args.worker.postMessage({ type: 'convert-tiff-to-png', input }, [input]);
  });
}

export function inspectTiffHeader(bytes: Uint8Array): TiffHeader {
  if (bytes.byteLength < 8) {
    throw new Error('TIFF header is truncated.');
  }
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!littleEndian && !bigEndian) {
    throw new Error('TIFF byte order marker is invalid.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(2, littleEndian);
  if (version === 43) {
    throw new Error('BigTIFF is not supported.');
  }
  if (version !== 42) {
    throw new Error('TIFF version marker is invalid.');
  }
  const firstIfdOffset = view.getUint32(4, littleEndian);
  if (firstIfdOffset < 8 || firstIfdOffset + 2 > bytes.byteLength) {
    throw new Error('TIFF first IFD offset is outside the input.');
  }
  const entryCount = view.getUint16(firstIfdOffset, littleEndian);
  if (entryCount > 256) {
    throw new Error('TIFF IFD entry count exceeds the supported limit.');
  }
  const tableEnd = firstIfdOffset + 2 + entryCount * 12 + 4;
  if (!Number.isSafeInteger(tableEnd) || tableEnd > bytes.byteLength) {
    throw new Error('TIFF IFD table is truncated.');
  }
  const typeSizes = Object.freeze([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8]);
  let storageOffsets: number[] | undefined;
  let storageByteCounts: number[] | undefined;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = firstIfdOffset + 2 + index * 12;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const typeSize = typeSizes[type];
    if (!typeSize) {
      throw new Error('TIFF IFD entry type or count is invalid.');
    }
    if (count === 0) continue;
    const payloadBytes = typeSize * count;
    if (!Number.isSafeInteger(payloadBytes)) {
      throw new Error('TIFF IFD payload size is unsafe.');
    }
    if (payloadBytes > 4) {
      const payloadOffset = view.getUint32(entryOffset + 8, littleEndian);
      const payloadEnd = payloadOffset + payloadBytes;
      if (
        !Number.isSafeInteger(payloadEnd) ||
        payloadOffset < 8 ||
        payloadEnd > bytes.byteLength
      ) {
        throw new Error('TIFF IFD payload is outside the input.');
      }
    }
    if ([273, 279, 324, 325].includes(tag) && [3, 4].includes(type)) {
      if (count > TIFF_TO_PNG_LIMITS.maxStorageSegments) {
        throw new Error('TIFF storage segment count exceeds the limit.');
      }
      const payloadOffset =
        payloadBytes <= 4
          ? entryOffset + 8
          : view.getUint32(entryOffset + 8, littleEndian);
      const values = Array.from({ length: count }, (_, valueIndex) =>
        type === 3
          ? view.getUint16(payloadOffset + valueIndex * 2, littleEndian)
          : view.getUint32(payloadOffset + valueIndex * 4, littleEndian),
      );
      if (tag === 273 || tag === 324) storageOffsets = values;
      else storageByteCounts = values;
    }
  }
  if (
    !storageOffsets ||
    !storageByteCounts ||
    storageOffsets.length !== storageByteCounts.length ||
    storageOffsets.some((offset, index) => {
      const byteCount = storageByteCounts?.[index] ?? 0;
      const end = offset + byteCount;
      return (
        byteCount < 1 ||
        offset < 8 ||
        !Number.isSafeInteger(end) ||
        end > bytes.byteLength
      );
    })
  ) {
    throw new Error('TIFF strip or tile storage range is invalid.');
  }
  return Object.freeze({
    byteOrder: littleEndian ? 'little' : 'big',
    firstIfdOffset,
  });
}

export const TIFF_TO_PNG_TOOL_IDS = Object.freeze([
  'tif-to-png',
  'tiff-to-png',
] as const);

export const TIFF_TO_PNG_LIMITS = Object.freeze({
  maxInputBytes: 32 * 1_024 * 1_024,
  maxDimension: 16_384,
  maxDecodedRgbaBytes: 64 * 1_024 * 1_024,
  maxOutputBytes: 64 * 1_024 * 1_024,
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
  if (
    ![1, 3, 4].includes(metadata.samplesPerPixel) ||
    metadata.bitsPerSample.length !== metadata.samplesPerPixel ||
    metadata.sampleFormat.length !== metadata.samplesPerPixel ||
    metadata.bitsPerSample.some((value) => value !== 8) ||
    metadata.sampleFormat.some((value) => value !== 1)
  ) {
    throw new Error('TIFF sample layout is unsupported.');
  }
  return Object.freeze({
    width: metadata.width,
    height: metadata.height,
    rgbaBytes,
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
  if (![0, 1, 2, 3].includes(Number(photometricInterpretation ?? -1))) {
    throw new Error('TIFF photometric interpretation is unsupported.');
  }
  if (
    samplesPerPixel === 4 &&
    ![1, 2].includes(Number(Array.from(extraSamples ?? [])[0]))
  ) {
    throw new Error('TIFF alpha sample layout is unsupported.');
  }
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
  if (firstIfdOffset < 8 || firstIfdOffset > bytes.byteLength) {
    throw new Error('TIFF first IFD offset is outside the input.');
  }
  return Object.freeze({
    byteOrder: littleEndian ? 'little' : 'big',
    firstIfdOffset,
  });
}

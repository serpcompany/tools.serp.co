import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { writeArrayBuffer } from 'geotiff';

import {
  TIFF_TO_PNG_LIMITS,
  TIFF_TO_PNG_TOOL_IDS,
  convertTiffBytesToPng,
  convertTiffToPngWithWorker,
  decodeTiffToRgba,
  inspectTiffHeader,
  normalizeTiffRgb,
  verifyTiffDecodedOutput,
  validateTiffImageMetadata,
} from './tiff.ts';
import { ownWorkerTermination } from './owned-worker.ts';

function classicTiffHeader(options: {
  byteOrder: 'big' | 'little';
  firstIfdOffset?: number;
}) {
  const bytes = new Uint8Array(39);
  const view = new DataView(bytes.buffer);
  const littleEndian = options.byteOrder === 'little';
  bytes.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]);
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, options.firstIfdOffset ?? 8, littleEndian);
  view.setUint16(8, 2, littleEndian);
  view.setUint16(10, 273, littleEndian);
  view.setUint16(12, 4, littleEndian);
  view.setUint32(14, 1, littleEndian);
  view.setUint32(18, 38, littleEndian);
  view.setUint16(22, 279, littleEndian);
  view.setUint16(24, 4, littleEndian);
  view.setUint32(26, 1, littleEndian);
  view.setUint32(30, 1, littleEndian);
  view.setUint32(34, 0, littleEndian);
  return bytes;
}

test('TIFF to PNG keeps one exact alias family and bounded resource policy', () => {
  assert.deepEqual(TIFF_TO_PNG_TOOL_IDS, ['tif-to-png', 'tiff-to-png']);
  assert.equal(
    createHash('sha256')
      .update(JSON.stringify([...TIFF_TO_PNG_TOOL_IDS].sort()))
      .digest('hex'),
    '7f1420b62963f2627681c66dce42b4e60d4eed43884490a3256655ce74f522f7',
  );
  assert.deepEqual(TIFF_TO_PNG_LIMITS, {
    maxInputBytes: 32 * 1_024 * 1_024,
    maxDimension: 16_384,
    maxDecodedRgbaBytes: 64 * 1_024 * 1_024,
    maxOutputBytes: 64 * 1_024 * 1_024,
    maxStorageSegments: 65_536,
    executionTimeoutMs: 10_000,
  });
});

test('TIFF output equivalence rejects wrong dimensions and same-size wrong pixels', async () => {
  const expectedRgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
  const sourceRgbaSha256 = createHash('sha256')
    .update(expectedRgba)
    .digest('hex');
  await assert.doesNotReject(() =>
    verifyTiffDecodedOutput({
      expected: { width: 2, height: 1, sourceRgbaSha256 },
      actual: { width: 2, height: 1, rgba: expectedRgba },
    }),
  );
  await assert.rejects(
    () =>
      verifyTiffDecodedOutput({
        expected: { width: 2, height: 1, sourceRgbaSha256 },
        actual: { width: 1, height: 2, rgba: expectedRgba },
      }),
    /dimensions/i,
  );
  await assert.rejects(
    () =>
      verifyTiffDecodedOutput({
        expected: { width: 2, height: 1, sourceRgbaSha256 },
        actual: {
          width: 2,
          height: 1,
          rgba: new Uint8Array([0, 0, 0, 255, 0, 255, 0, 255]),
        },
      }),
    /pixels/i,
  );
});

test('TIFF worker client aborts by termination and suppresses late success', async () => {
  let terminated = 0;
  const rawWorker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage() {},
    terminate() {
      terminated += 1;
    },
  } as unknown as Worker;
  const worker = ownWorkerTermination(rawWorker);
  const controller = new AbortController();
  const pending = convertTiffToPngWithWorker({
    worker,
    bytes: classicTiffHeader({ byteOrder: 'little' }),
    signal: controller.signal,
  });
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(terminated, 1);

  worker.onmessage?.(
    new MessageEvent('message', {
      data: {
        ok: true,
        png: new ArrayBuffer(8),
        width: 1,
        height: 1,
        sourceRgbaSha256: 'late',
      },
    }),
  );
  assert.equal(terminated, 1);
});

test('TIFF worker client enforces the owned ten-second timeout and suppresses late success', async () => {
  let terminated = 0;
  let scheduledDelay = 0;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    scheduledDelay = Number(delay);
    queueMicrotask(callback);
    return 1 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  const rawWorker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null,
    postMessage() {},
    terminate() {
      terminated += 1;
    },
  } as unknown as Worker;
  const worker = ownWorkerTermination(rawWorker);
  try {
    const pending = convertTiffToPngWithWorker({
      worker,
      bytes: classicTiffHeader({ byteOrder: 'little' }),
    });
    await assert.rejects(pending, /execution timeout/i);
    assert.equal(scheduledDelay, TIFF_TO_PNG_LIMITS.executionTimeoutMs);
    assert.equal(terminated, 1);
    worker.terminate();
    assert.equal(terminated, 1);
    worker.onmessage?.({
      data: {
        ok: true,
        png: new ArrayBuffer(8),
        width: 1,
        height: 1,
        sourceRgbaSha256: 'late',
      },
    } as MessageEvent);
    assert.equal(terminated, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('TIFF worker termination owns cancellation during decode and encode', async () => {
  for (const stage of ['decode', 'encode'] as const) {
    let terminated = 0;
    const controller = new AbortController();
    const worker = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage() {
        (
          worker as unknown as {
            onmessage: ((event: MessageEvent<unknown>) => void) | null;
          }
        ).onmessage?.(
          new MessageEvent('message', {
            data: { type: 'progress', stage },
          }),
        );
      },
      terminate() {
        terminated += 1;
      },
    } as unknown as Worker;
    const pending = convertTiffToPngWithWorker({
      worker,
      bytes: classicTiffHeader({ byteOrder: 'little' }),
      signal: controller.signal,
      onStage(observed) {
        assert.equal(observed, stage);
        controller.abort(
          new DOMException(`cancelled during ${stage}`, 'AbortError'),
        );
      },
    });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(terminated, 1, stage);
  }
});

test('geotiff decodes an owned 8-bit RGB raster without a nested worker pool', async () => {
  const input = writeArrayBuffer(new Uint8Array([255, 0, 0, 0, 255, 0]), {
    width: 2,
    height: 1,
    SamplesPerPixel: 3,
    BitsPerSample: [8, 8, 8],
    SampleFormat: [1, 1, 1],
    PhotometricInterpretation: 2,
    PlanarConfiguration: 1,
  });
  const decoded = await decodeTiffToRgba(new Uint8Array(input));
  assert.deepEqual(decoded, {
    width: 2,
    height: 1,
    rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  });
});

test('TIFF conversion emits an exact bounded PNG with source pixel identity', async () => {
  const input = writeArrayBuffer(new Uint8Array([255, 0, 0, 0, 255, 0]), {
    width: 2,
    height: 1,
    SamplesPerPixel: 3,
    BitsPerSample: [8, 8, 8],
    SampleFormat: [1, 1, 1],
    PhotometricInterpretation: 2,
    PlanarConfiguration: 1,
  });
  const result = await convertTiffBytesToPng(new Uint8Array(input));
  const view = new DataView(
    result.png.buffer,
    result.png.byteOffset,
    result.png.byteLength,
  );
  assert.deepEqual([view.getUint32(16), view.getUint32(20)], [2, 1]);
  assert.equal(
    result.sourceRgbaSha256,
    createHash('sha256')
      .update(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]))
      .digest('hex'),
  );
});

test('owned endian, storage, compression, grayscale, RGB, and alpha fixtures decode deterministically', async () => {
  for (const [name, dimensions] of [
    ['grayscale-little-stripped-deflate.tiff', [16, 16]],
    ['palette-little-stripped-lzw.tiff', [256, 1]],
    ['rgb-big-tiled-lzw.tiff', [16, 16]],
    ['rgb-little-stripped-none.tiff', [16, 16]],
    ['rgba-big-stripped-none.tiff', [16, 16]],
  ] as const) {
    const bytes = new Uint8Array(
      readFileSync(
        new URL(`../../benchmarks/fixtures/tiff/${name}`, import.meta.url),
      ),
    );
    const first = await convertTiffBytesToPng(bytes);
    const second = await convertTiffBytesToPng(bytes);
    assert.deepEqual([first.width, first.height], dimensions, name);
    assert.deepEqual(first.png, second.png, name);
    assert.equal(first.sourceRgbaSha256, second.sourceRgbaSha256, name);
  }
});

test('owned TIFF identity, layout, offset, sample, and expansion fixtures fail closed', async () => {
  for (const name of [
    'negative-associated-alpha.tiff',
    'negative-bigtiff.tiff',
    'negative-decompression-expansion.tiff',
    'negative-floating-point.tiff',
    'negative-higher-depth.tiff',
    'negative-multipage.tiff',
    'negative-oversized-dimension.tiff',
    'negative-strip-byte-count.tiff',
    'negative-strip-offset.tiff',
    'negative-truncated-ifd.tiff',
    'negative-truncated-strip.tiff',
    'negative-unsupported-photometric.tiff',
  ]) {
    const bytes = new Uint8Array(
      readFileSync(
        new URL(`../../benchmarks/fixtures/tiff/${name}`, import.meta.url),
      ),
    );
    await assert.rejects(() => convertTiffBytesToPng(bytes), name);
  }
});

test('TIFF metadata fails closed before decoded raster allocation', () => {
  assert.deepEqual(
    validateTiffImageMetadata({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8, 8],
      sampleFormat: [1, 1, 1],
      samplesPerPixel: 3,
      imageCount: 1,
      photometricInterpretation: 2,
      extraSamples: [],
    }),
    { width: 2, height: 1, rgbaBytes: 8, pngUpperBound: 142 },
  );

  for (const metadata of [
    { width: 16_385, height: 1, bitsPerSample: [8], sampleFormat: [1] },
    { width: 4_096, height: 4_097, bitsPerSample: [8], sampleFormat: [1] },
    { width: 4_096, height: 4_096, bitsPerSample: [8], sampleFormat: [1] },
    { width: 1, height: 1, bitsPerSample: [16], sampleFormat: [1] },
    { width: 1, height: 1, bitsPerSample: [8], sampleFormat: [3] },
    {
      width: 1,
      height: 1,
      bitsPerSample: [8],
      sampleFormat: [1],
      imageCount: 2,
    },
  ]) {
    assert.throws(
      () =>
        validateTiffImageMetadata({
          samplesPerPixel: 1,
          imageCount: 1,
          photometricInterpretation: 1,
          extraSamples: [],
          ...metadata,
        }),
      /unsupported|limit|single image/i,
    );
  }

  assert.throws(
    () =>
      validateTiffImageMetadata({
        width: 1,
        height: 1,
        bitsPerSample: [8, 8, 8, 8],
        sampleFormat: [1, 1, 1, 1],
        samplesPerPixel: 4,
        imageCount: 1,
        photometricInterpretation: 2,
        extraSamples: [1],
      }),
    /associated alpha/i,
  );
  for (const metadata of [
    { photometricInterpretation: 1, samplesPerPixel: 3 },
    { photometricInterpretation: 2, samplesPerPixel: 1 },
    { photometricInterpretation: 3, samplesPerPixel: 3 },
  ]) {
    assert.throws(
      () =>
        validateTiffImageMetadata({
          width: 1,
          height: 1,
          bitsPerSample: Array(metadata.samplesPerPixel).fill(8),
          sampleFormat: Array(metadata.samplesPerPixel).fill(1),
          imageCount: 1,
          extraSamples: [],
          ...metadata,
        }),
      /photometric.*sample/i,
    );
  }
  for (const metadata of [
    { samplesPerPixel: 3, extraSamples: [2] },
    { samplesPerPixel: 4, extraSamples: [2, 2] },
  ]) {
    assert.throws(
      () =>
        validateTiffImageMetadata({
          width: 1,
          height: 1,
          bitsPerSample: Array(metadata.samplesPerPixel).fill(8),
          sampleFormat: Array(metadata.samplesPerPixel).fill(1),
          imageCount: 1,
          photometricInterpretation: 2,
          ...metadata,
        }),
      /ExtraSamples|alpha sample/i,
    );
  }
});

test('TIFF RGB normalization creates exact opaque RGBA and preserves alpha', () => {
  assert.deepEqual(
    normalizeTiffRgb(new Uint8Array([10, 20, 30, 40, 50, 60]), 2, 1),
    new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]),
  );
  assert.deepEqual(
    normalizeTiffRgb(new Uint8Array([10, 20, 30, 40]), 1, 1),
    new Uint8Array([10, 20, 30, 40]),
  );
  assert.throws(
    () => normalizeTiffRgb(new Uint8Array([10, 20]), 1, 1),
    /length/i,
  );
});

test('TIFF preflight accepts classic endian variants and rejects unsafe identities', () => {
  assert.deepEqual(
    inspectTiffHeader(classicTiffHeader({ byteOrder: 'little' })),
    {
      byteOrder: 'little',
      firstIfdOffset: 8,
    },
  );
  assert.deepEqual(inspectTiffHeader(classicTiffHeader({ byteOrder: 'big' })), {
    byteOrder: 'big',
    firstIfdOffset: 8,
  });

  assert.throws(() => inspectTiffHeader(new Uint8Array([0x49, 0x49, 42])), {
    message: /truncated/i,
  });
  assert.throws(
    () => inspectTiffHeader(new Uint8Array([0x49, 0x49, 43, 0, 8, 0, 0, 0])),
    { message: /BigTIFF/i },
  );
  assert.throws(
    () =>
      inspectTiffHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])),
    { message: /byte order/i },
  );
  assert.throws(
    () =>
      inspectTiffHeader(
        classicTiffHeader({ byteOrder: 'little', firstIfdOffset: 128 }),
      ),
    { message: /offset/i },
  );

  const unsafeEntryCount = classicTiffHeader({ byteOrder: 'little' });
  new DataView(unsafeEntryCount.buffer).setUint16(8, 257, true);
  assert.throws(() => inspectTiffHeader(unsafeEntryCount), {
    message: /entry count/i,
  });

  const unsafePayload = new Uint8Array(26);
  unsafePayload.set(classicTiffHeader({ byteOrder: 'little' }).slice(0, 8));
  const view = new DataView(unsafePayload.buffer);
  view.setUint16(8, 1, true);
  view.setUint16(10, 258, true);
  view.setUint16(12, 3, true);
  view.setUint32(14, 3, true);
  view.setUint32(18, 24, true);
  view.setUint32(22, 0, true);
  assert.throws(() => inspectTiffHeader(unsafePayload), {
    message: /payload/i,
  });

  const excessiveSegments = new Uint8Array(38 + 65_537 * 4);
  excessiveSegments.set(classicTiffHeader({ byteOrder: 'little' }).slice(0, 8));
  const segmentView = new DataView(excessiveSegments.buffer);
  segmentView.setUint16(8, 2, true);
  segmentView.setUint16(10, 273, true);
  segmentView.setUint16(12, 4, true);
  segmentView.setUint32(14, 65_537, true);
  segmentView.setUint32(18, 38, true);
  segmentView.setUint16(22, 279, true);
  segmentView.setUint16(24, 4, true);
  segmentView.setUint32(26, 65_537, true);
  segmentView.setUint32(30, 38, true);
  segmentView.setUint32(34, 0, true);
  assert.throws(() => inspectTiffHeader(excessiveSegments), {
    message: /segment count/i,
  });
});

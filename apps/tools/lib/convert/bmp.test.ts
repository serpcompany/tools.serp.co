import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';
import UPNGModule from 'upng-js';
import { readFileSync } from 'node:fs';

import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import {
  BMP_CONVERSION_TOOL_IDS,
  BMP_CONVERSION_TOOL_IDS_SHA256,
  BMP_ENGINE_CONTRACT,
  inspectBmp,
  verifyBmpConversionSemantics,
} from './bmp.ts';
import {
  createGenericToolWorkflow,
  decideGenericBrowserSupport,
  detectGenericMediaMimeType,
  getGenericToolContract,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from '../generic-tool-workflow.ts';
import { getToolProcessorAvailability } from '../tool-processor-registry.ts';
import { selectToolRenderer } from '../tool-renderer.ts';
import { getTableOperationPolicy } from '../table-operation-policy.ts';
import { summarizeToolAcceptance } from '../../../../scripts/lib/tool-acceptance-classification.mjs';

function generatedBmp(width = 8, height = 8): Uint8Array {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const bytes = new Uint8Array(54 + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.byteLength, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(30, 0, true);
  view.setUint32(34, pixelBytes, true);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowStride + x * 3;
      const right = x >= width / 2;
      const bottom = y >= height / 2;
      const [red, green, blue] = bottom
        ? right
          ? [255, 255, 255]
          : [0, 0, 255]
        : right
          ? [0, 255, 0]
          : [255, 0, 0];
      bytes.set([blue, green, red], offset);
    }
  }
  return bytes;
}

const bmpMedia = (bytes: Uint8Array) => ({
  name: 'independently-generated.bmp',
  format: 'bmp',
  mimeType: 'image/bmp',
  bytes,
});

function encodedPng(rgba: Uint8Array, width = 8, height = 8): Uint8Array {
  const UPNG = UPNGModule as {
    encode(
      buffers: ArrayBuffer[],
      width: number,
      height: number,
      colors: number,
    ): ArrayBuffer;
  };
  return new Uint8Array(UPNG.encode([rgba.slice().buffer], width, height, 0));
}

test('the approved BMP wave is exactly five IDs with a stable membership hash', () => {
  assert.deepEqual(BMP_CONVERSION_TOOL_IDS, [
    'bmp-to-jpeg',
    'bmp-to-jpg',
    'bmp-to-pdf',
    'bmp-to-png',
    'bmp-to-webp',
  ]);
  assert.equal(
    BMP_CONVERSION_TOOL_IDS_SHA256,
    `sha256:${crypto
      .createHash('sha256')
      .update(JSON.stringify(BMP_CONVERSION_TOOL_IDS))
      .digest('hex')}`,
  );
  assert.deepEqual(BMP_ENGINE_CONTRACT, {
    decode: 'browser-platform-image-codec',
    encode: 'browser-canvas-codec',
    pdf: 'pdf-lib',
    fallback: 'fail-closed',
  });
  assert.equal(
    BMP_CONVERSION_TOOL_IDS_SHA256,
    'sha256:e079eafef5b2221a25a123f5bb65d20f9cf95c81ed01b24426b328b345a2f99d',
  );
  for (const toolId of BMP_CONVERSION_TOOL_IDS) {
    assert.equal(getGenericToolContract(toolId).state, 'supported', toolId);
    assert.equal(getToolProcessorAvailability(toolId).kind, 'wired', toolId);
  }
  const neighboringBmpIds = toolCatalog.activeTools
    .filter(
      (tool) =>
        tool.from === 'bmp' &&
        !BMP_CONVERSION_TOOL_IDS.includes(tool.id as never),
    )
    .map((tool) => tool.id);
  assert.ok(neighboringBmpIds.length > 10);
  for (const toolId of neighboringBmpIds) {
    assert.equal(getGenericToolContract(toolId).state, 'unsupported', toolId);
    assert.notEqual(getToolProcessorAvailability(toolId).kind, 'wired', toolId);
  }
});

test('the accepted processor projection excludes the security-blocked HEIF wave', () => {
  const summary = summarizeToolAcceptance(
    toolCatalog.activeTools.map((tool) => ({
      id: tool.id,
      availabilityKind: getToolProcessorAvailability(tool.id).kind,
      renderer: selectToolRenderer(tool),
      genericContractState: getGenericToolContract(tool.id).state,
      tablePolicyKind: getTableOperationPolicy(tool.id).kind,
    })),
  );
  assert.deepEqual(summary.counts, {
    supported: 436,
    unsupported: 2_368,
    unwired: 0,
    unknown: 3,
  });
  assert.deepEqual(
    summary.toolIds.supported.filter((id: string) => id.startsWith('bmp-to-')),
    BMP_CONVERSION_TOOL_IDS,
  );
});

test('missing browser BMP codec capability fails closed before processing', () => {
  assert.deepEqual(
    decideGenericBrowserSupport(
      { operation: 'convert', inputFormat: 'bmp', outputFormat: 'png' },
      true,
      false,
    ),
    {
      supported: false,
      message: 'BMP conversion is not available in this browser.',
    },
  );
});

test('BMP identity is byte-derived, bounded, and rejects malformed or polyglot inputs', async () => {
  const positive = generatedBmp();
  const inspection = inspectBmp(positive);
  assert.equal(inspection.status, 'verified');
  if (inspection.status !== 'verified') return;
  assert.deepEqual(
    {
      width: inspection.width,
      height: inspection.height,
      bitsPerPixel: inspection.bitsPerPixel,
      topDown: inspection.topDown,
    },
    { width: 8, height: 8, bitsPerPixel: 24, topDown: true },
  );
  assert.equal(inspection.rgba.byteLength, 8 * 8 * 4);
  assert.equal(await detectGenericMediaMimeType(positive), 'image/bmp');

  const truncated = positive.subarray(0, positive.byteLength - 1);
  const malformedHeader = Uint8Array.from(positive);
  malformedHeader[0] = 0x5a;
  const malformedDib = Uint8Array.from(positive);
  new DataView(malformedDib.buffer).setUint32(14, 12, true);
  const oversized = Uint8Array.from(positive);
  new DataView(oversized.buffer).setInt32(18, 16_385, true);
  const pngSpoof = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const jpegSpoof = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const validRenamedPng = new Uint8Array(
    readFileSync(
      new URL('../../benchmarks/fixtures/sample.png', import.meta.url),
    ),
  );
  const validRenamedJpeg = new Uint8Array(
    readFileSync(
      new URL('../../benchmarks/fixtures/sample.jpg', import.meta.url),
    ),
  );
  const polyglot = new Uint8Array(positive.byteLength + pngSpoof.byteLength);
  polyglot.set(positive);
  polyglot.set(pngSpoof, positive.byteLength);
  const invalidReserved = Uint8Array.from(positive);
  new DataView(invalidReserved.buffer).setUint32(6, 1, true);
  const invalidPixelOffset = Uint8Array.from(positive);
  new DataView(invalidPixelOffset.buffer).setUint32(10, 55, true);
  const invalidPlanes = Uint8Array.from(positive);
  new DataView(invalidPlanes.buffer).setUint16(26, 2, true);
  const invalidBits = Uint8Array.from(positive);
  new DataView(invalidBits.buffer).setUint16(28, 32, true);
  const compressed = Uint8Array.from(positive);
  new DataView(compressed.buffer).setUint32(30, 1, true);
  const invalidImageSize = Uint8Array.from(positive);
  new DataView(invalidImageSize.buffer).setUint32(34, 1, true);

  for (const bytes of [
    new Uint8Array(),
    truncated,
    malformedHeader,
    malformedDib,
    oversized,
    pngSpoof,
    jpegSpoof,
    validRenamedPng,
    validRenamedJpeg,
    polyglot,
    invalidReserved,
    invalidPixelOffset,
    invalidPlanes,
    invalidBits,
    compressed,
    invalidImageSize,
  ]) {
    assert.equal(inspectBmp(bytes).status, 'rejected');
    assert.notEqual(await detectGenericMediaMimeType(bytes), 'image/bmp');
    assert.equal(
      (
        await verifyGenericMediaSemantics({
          ...bmpMedia(bytes),
          name: 'renamed.bmp',
        })
      ).status,
      'rejected',
    );
  }
});

test('BMP conversion evidence checks decoded dimensions and content with lossy tolerance', async () => {
  const source = generatedBmp();
  const inputPixels = inspectBmp(source);
  assert.equal(inputPixels.status, 'verified');
  if (inputPixels.status !== 'verified') return;
  const exact = Uint8Array.from(inputPixels.rgba);
  const slightlyLossy = Uint8Array.from(exact, (value, index) =>
    index % 4 === 3
      ? value
      : Math.max(0, Math.min(255, value + (value === 255 ? -4 : 4))),
  );
  const wrong = Uint8Array.from(exact, (value, index) =>
    index % 4 === 3 ? value : 255 - value,
  );
  const transparent = Uint8Array.from(exact, (value, index) =>
    index % 4 === 3 ? 0 : value,
  );
  const translucent = Uint8Array.from(exact, (value, index) =>
    index % 4 === 3 ? 128 : value,
  );
  const decode = async (bytes: Uint8Array) => ({
    width: 8,
    height: 8,
    rgba: bytes,
  });
  assert.deepEqual(
    await verifyBmpConversionSemantics({
      input: source,
      output: { format: 'png', bytes: exact },
      decode,
    }),
    { status: 'verified' },
  );
  assert.deepEqual(
    await verifyBmpConversionSemantics({
      input: source,
      output: { format: 'jpg', bytes: slightlyLossy },
      decode,
    }),
    { status: 'verified' },
  );
  assert.equal(
    (
      await verifyBmpConversionSemantics({
        input: source,
        output: { format: 'webp', bytes: wrong },
        decode,
      })
    ).status,
    'rejected',
  );
  assert.equal(
    (
      await verifyBmpConversionSemantics({
        input: source,
        output: { format: 'webp', bytes: translucent },
        decode,
      })
    ).status,
    'rejected',
  );
  assert.equal(
    (
      await verifyBmpConversionSemantics({
        input: source,
        output: { format: 'webp', bytes: transparent },
        decode,
      })
    ).status,
    'rejected',
  );
  assert.equal(
    (
      await verifyBmpConversionSemantics({
        input: source,
        output: { format: 'png', bytes: exact },
        decode: async (bytes) => ({ width: 7, height: 8, rgba: bytes }),
      })
    ).status,
    'rejected',
  );
});

test('BMP-to-PDF evidence requires one bounded page and real image content', async () => {
  const source = generatedBmp();
  const sourceInspection = inspectBmp(source);
  assert.equal(sourceInspection.status, 'verified');
  if (sourceInspection.status !== 'verified') return;
  const valid = await PDFDocument.create();
  const image = await valid.embedPng(encodedPng(sourceInspection.rgba));
  const page = valid.addPage([8, 8]);
  page.drawImage(image, { x: 0, y: 0, width: 8, height: 8 });
  const validBytes = await valid.save();

  const blank = await PDFDocument.create();
  blank.addPage([8, 8]);
  const blankBytes = await blank.save();
  const wrongSize = await PDFDocument.create();
  wrongSize.addPage([9, 8]);
  const wrongSizeBytes = await wrongSize.save();
  const wrongContent = await PDFDocument.create();
  const red = new Uint8Array(8 * 8 * 4);
  for (let index = 0; index < red.byteLength; index += 4) {
    red.set([255, 0, 0, 255], index);
  }
  const redImage = await wrongContent.embedPng(encodedPng(red));
  const redPage = wrongContent.addPage([8, 8]);
  redPage.drawImage(redImage, { x: 0, y: 0, width: 8, height: 8 });
  const wrongContentBytes = await wrongContent.save();
  const orphan = await PDFDocument.create();
  await orphan.embedPng(encodedPng(sourceInspection.rgba));
  orphan.addPage([8, 8]);
  const orphanBytes = await orphan.save();
  const zeroSized = await PDFDocument.create();
  const zeroImage = await zeroSized.embedPng(encodedPng(sourceInspection.rgba));
  const zeroPage = zeroSized.addPage([8, 8]);
  zeroPage.drawImage(zeroImage, { x: 0, y: 0, width: 0, height: 0 });
  const zeroSizedBytes = await zeroSized.save();
  const thumbnail = await PDFDocument.create();
  const thumbnailImage = await thumbnail.embedPng(
    encodedPng(sourceInspection.rgba),
  );
  const thumbnailPage = thumbnail.addPage([8, 8]);
  thumbnailPage.drawImage(thumbnailImage, { x: 0, y: 0, width: 1, height: 1 });
  const thumbnailBytes = await thumbnail.save();
  const offPage = await PDFDocument.create();
  const offPageImage = await offPage.embedPng(
    encodedPng(sourceInspection.rgba),
  );
  const displacedPage = offPage.addPage([8, 8]);
  displacedPage.drawImage(offPageImage, { x: 8, y: 8, width: 8, height: 8 });
  const offPageBytes = await offPage.save();

  assert.deepEqual(
    await verifyBmpConversionSemantics({
      input: source,
      output: { format: 'pdf', bytes: validBytes },
    }),
    { status: 'verified' },
  );
  for (const bytes of [
    blankBytes,
    wrongSizeBytes,
    wrongContentBytes,
    orphanBytes,
    zeroSizedBytes,
    thumbnailBytes,
    offPageBytes,
  ]) {
    assert.equal(
      (
        await verifyBmpConversionSemantics({
          input: source,
          output: { format: 'pdf', bytes },
        })
      ).status,
      'rejected',
    );
  }
});

test('BMP processing and semantic-verification cancellation release workers and suppress delivery', async () => {
  for (const phase of ['processing', 'verification'] as const) {
    const input = generatedBmp();
    const inspected = inspectBmp(input);
    assert.equal(inspected.status, 'verified');
    if (inspected.status !== 'verified') return;
    const output = encodedPng(inspected.rgba);
    const controller = new AbortController();
    let enteredPhase!: () => void;
    const entered = new Promise<void>((resolve) => {
      enteredPhase = resolve;
    });
    let workerTerminations = 0;
    let deliveries = 0;
    const terminals: string[] = [];
    const stall = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () =>
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    const boundary: GenericWorkflowAdapters = {
      decideSupport: () => ({ supported: true }),
      async convert({ context }) {
        await context.registerWorker({
          terminate() {
            workerTerminations += 1;
          },
        } as Worker);
        if (phase === 'processing') {
          enteredPhase();
          return stall(context.signal);
        }
        return [output];
      },
      async compress() {
        throw new Error('not used');
      },
      async verify() {
        return { status: 'verified' };
      },
      async decodeRaster(_media, { signal }) {
        enteredPhase();
        return stall(signal);
      },
      async deliver() {
        deliveries += 1;
        return 'delivery';
      },
      telemetry: {
        async start() {},
        async terminal(_runId, status) {
          terminals.push(status);
        },
      },
    };
    const pending = createGenericToolWorkflow(boundary).run(
      {
        toolId: 'bmp-to-png',
        input: { kind: 'file', media: bmpMedia(input) },
      },
      { signal: controller.signal },
    );
    await entered;
    controller.abort(new DOMException('Replaced', 'AbortError'));
    const outcome = await pending;
    assert.equal(outcome.status, 'cancelled', phase);
    assert.equal(deliveries, 0, phase);
    assert.equal(workerTerminations, 1, phase);
    assert.deepEqual(terminals, ['cancelled'], phase);
  }
});

test('every adversarial BMP fails before processing or delivery with one truthful terminal', async () => {
  const terminals: string[] = [];
  let processed = 0;
  let delivered = 0;
  const boundary: GenericWorkflowAdapters = {
    decideSupport: () => ({ supported: true }),
    async convert() {
      processed += 1;
      return [new Uint8Array([1])];
    },
    async compress() {
      throw new Error('not used');
    },
    async verify() {
      return { status: 'verified' };
    },
    async deliver() {
      delivered += 1;
      return 'delivery';
    },
    telemetry: {
      async start() {},
      async terminal(_runId, status) {
        terminals.push(status);
      },
    },
  };
  const workflow = createGenericToolWorkflow(boundary);
  for (const bytes of [
    generatedBmp().subarray(0, 53),
    new Uint8Array([0x42, 0x4d, 0, 0]),
  ]) {
    const outcome = await workflow.run({
      toolId: 'bmp-to-png',
      input: { kind: 'file', media: bmpMedia(bytes) },
    });
    assert.equal(outcome.status, 'failed');
    assert.deepEqual(outcome.telemetry, {
      start: 'not-attempted',
      terminal: 'not-attempted',
    });
  }
  assert.equal(processed, 0);
  assert.equal(delivered, 0);
  assert.deepEqual(terminals, []);
});

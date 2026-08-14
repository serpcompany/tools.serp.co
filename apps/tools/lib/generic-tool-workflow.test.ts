import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { before } from 'node:test';

import { init as initializeJpegDecoder } from '@jsquash/jpeg/decode.js';
import { PDFDocument } from 'pdf-lib';
import UPNGModule from 'upng-js';

import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import {
  BROWSER_WEBM_TOOL_IDS,
  createGenericToolWorkflow,
  decideGenericBrowserSupport,
  detectGenericMediaMimeType,
  deliverBrowserMedia,
  getGenericAccept,
  genericCompressionNeedsWorker,
  getGenericToolContract,
  runGenericToolFile,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from './generic-tool-workflow.ts';
import { getToolProcessorAvailability } from './tool-processor-registry.ts';
import { selectToolRenderer } from './tool-renderer.ts';
import {
  resolveConversionCapability,
  resolveConversionDispatch,
} from './convert/conversion-dispatch.ts';
import { resolveCompressionDispatch } from './compression-utils.ts';
import { createGenericToolRunController } from './generic-tool-run-controller.ts';
import { runFfmpegLifecycle } from './convert/ffmpeg-lifecycle.ts';
import { decodeToRGBA } from './convert/decode.ts';
import { convertWithWorker } from './convert/workerClient.ts';
import { inspectBmp } from './convert/bmp.ts';
import {
  convertIcoToPngWithWorker,
  ICO_TO_PNG_CANDIDATE_CONTRACT,
} from './convert/ico.ts';
import { ownWorkerTermination } from './convert/owned-worker.ts';
import { compressSvgWithWorker } from './svg-compression.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

test('TIFF uses the classic Worker mode required by its emitted browser chunk', () => {
  const source = readFileSync(
    new URL('./generic-tool-workflow.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /new Worker\(\s*new URL\('\.\.\/workers\/tiff-to-png\.worker\.js', import\.meta\.url\),\s*\)/,
  );
});

test('ICO conversion uses its lazy dedicated module Worker', () => {
  const source = readFileSync(
    new URL('./generic-tool-workflow.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /new Worker\(\s*new URL\('\.\.\/workers\/ico-to-png\.worker\.js', import\.meta\.url\),\s*\{ type: 'module' \},\s*\)/,
  );
});

function mp4WithoutRecognizedAudioTrack(): Uint8Array {
  const bytes = Uint8Array.from(fixture('sample.mp4'));
  const marker = new TextEncoder().encode('mp4a');
  const offset = bytes.findIndex((_byte, index) =>
    marker.every((value, part) => bytes[index + part] === value),
  );
  assert.ok(offset >= 0, 'fixture must contain an audio sample entry');
  bytes.set(new TextEncoder().encode('xxxx'), offset);
  return bytes;
}

before(async () => {
  const require = createRequire(import.meta.url);
  const wasm = await WebAssembly.compile(
    Uint8Array.from(
      readFileSync(require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')),
    ),
  );
  await (
    initializeJpegDecoder as unknown as (
      module: WebAssembly.Module,
    ) => Promise<void>
  )(wasm);
});

function adapters(output: Uint8Array): GenericWorkflowAdapters & {
  delivered: string[];
  processed: string[];
} {
  const delivered: string[] = [];
  const processed: string[] = [];
  return {
    delivered,
    processed,
    decideSupport() {
      return { supported: true };
    },
    async convert(request) {
      processed.push(`${request.from}->${request.to}`);
      return [output];
    },
    async compress(request) {
      processed.push(`compress:${request.format}`);
      return output;
    },
    async verify() {
      return { status: 'verified' };
    },
    async verifySvgEquivalence() {
      return { status: 'verified' };
    },
    async verifyTiffEquivalence() {
      return { status: 'verified' };
    },
    async deliver(result) {
      delivered.push(result.name);
      return `delivery-${delivered.length}`;
    },
    telemetry: {
      async start() {},
      async terminal() {},
    },
  };
}

test('every active generic renderer Tool has an explicit processor contract state', () => {
  const portfolio = toolCatalog.activeTools.filter(
    (tool) => selectToolRenderer(tool) === 'generic',
  );
  assert.ok(portfolio.length > 2_000);
  for (const tool of portfolio) {
    const contract = getGenericToolContract(tool.id);
    assert.equal(contract.toolId, tool.id);
    assert.match(contract.state, /^(supported|unsupported)$/);
    if (contract.state === 'unsupported') {
      assert.ok(contract.reason.length > 20, tool.id);
      assert.notEqual(getToolProcessorAvailability(tool.id).kind, 'wired');
    } else {
      assert.deepEqual(getToolProcessorAvailability(tool.id), {
        kind: 'wired',
        toolId: tool.id,
        adapterId: contract.adapterId,
      });
    }
  }
});

test('known production dispatches retain exact generic workflow contracts', () => {
  for (const toolId of ['png-to-webp', 'webp-to-jpg', 'heic-to-jpg']) {
    assert.equal(getGenericToolContract(toolId).state, 'supported', toolId);
  }
  for (const toolId of [
    'cr2-to-jpg',
    'm4a-to-mp4',
    'mp3-to-mp4',
    'compress-m4a',
    'compress-mp3',
    'compress-mp4',
    'm4a-to-mp3',
    'mp3-to-m4a',
    'mp4-to-m4a',
    'mp4-to-mp3',
  ]) {
    assert.equal(getGenericToolContract(toolId).state, 'unsupported', toolId);
  }
});

test('TIFF to PNG aliases alone use the dedicated browser conversion contract', () => {
  for (const toolId of ['tif-to-png', 'tiff-to-png']) {
    assert.deepEqual(getGenericToolContract(toolId), {
      state: 'supported',
      toolId,
      adapterId: 'generic-conversion',
      operation: 'convert',
      input: {
        format: toolId.startsWith('tiff-') ? 'tiff' : 'tif',
        mimeType: 'image/tiff',
      },
      output: { format: 'png', mimeType: 'image/png' },
    });
  }
  for (const toolId of [
    'tif-to-jpg',
    'tif-to-webp',
    'tiff-to-jpg',
    'tiff-to-pdf',
    'tiff-to-webp',
  ]) {
    assert.equal(getGenericToolContract(toolId).state, 'unsupported', toolId);
  }
});

test('ICO to PNG candidate stays unregistered until exact preview proof', () => {
  assert.deepEqual(resolveConversionDispatch('ico', 'png'), {
    kind: 'browser-ico-worker',
    engineIds: ['browser-ico-png-worker'],
  });
  assert.equal(getGenericToolContract('ico-to-png').state, 'unsupported');
  assert.equal(ICO_TO_PNG_CANDIDATE_CONTRACT.toolId, 'ico-to-png');
  for (const toolId of ['ico-to-jpg', 'ico-to-pdf', 'ico-to-webp']) {
    assert.equal(getGenericToolContract(toolId).state, 'unsupported', toolId);
  }
});

test('ICO workflow rejects changed selected pixels before delivery', async () => {
  let deliveries = 0;
  const workflow = createGenericToolWorkflow(
    {
      ...adapters(fixture('sample.png')),
      async verifyIcoEquivalence() {
        return { status: 'rejected', message: 'selected pixels differ' };
      },
      async deliver() {
        deliveries += 1;
        return 'unexpected';
      },
    },
    {
      resolveContract: () => ICO_TO_PNG_CANDIDATE_CONTRACT,
    },
  );
  const outcome = await workflow.run({
    toolId: 'ico-to-png',
    input: {
      kind: 'file',
      media: {
        name: 'sample.ico',
        format: 'ico',
        mimeType: 'image/x-icon',
        bytes: fixture('sample.ico'),
      },
    },
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(deliveries, 0);
});

test('ICO cancellation during semantic verification suppresses delivery', async () => {
  const controller = new AbortController();
  let verificationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    verificationStarted = resolve;
  });
  const boundary = adapters(fixture('sample.png'));
  const workflow = createGenericToolWorkflow(
    {
      ...boundary,
      async verifyIcoEquivalence(_output, { signal }) {
        verificationStarted();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        return { status: 'verified' };
      },
    },
    {
      resolveContract: () => ICO_TO_PNG_CANDIDATE_CONTRACT,
    },
  );
  const pending = workflow.run(
    {
      toolId: 'ico-to-png',
      input: {
        kind: 'file',
        media: {
          name: 'sample.ico',
          format: 'ico',
          mimeType: 'image/x-icon',
          bytes: fixture('sample.ico'),
        },
      },
    },
    { signal: controller.signal },
  );

  await started;
  controller.abort(new DOMException('cancelled', 'AbortError'));
  const outcome = await pending;
  assert.equal(outcome.status, 'cancelled');
  assert.deepEqual(boundary.delivered, []);
});

test('ICO input identity is byte-derived instead of trusting the extension', async () => {
  assert.equal(
    await detectGenericMediaMimeType(fixture('sample.ico')),
    'image/x-icon',
  );
  assert.notEqual(
    await detectGenericMediaMimeType(fixture('sample.png')),
    'image/x-icon',
  );
});

test('TIFF workflow rejects wrong pixels before delivery', async () => {
  let deliveries = 0;
  const base = adapters(fixture('sample.png'));
  const workflow = createGenericToolWorkflow({
    ...base,
    async verifyTiffEquivalence() {
      return { status: 'rejected', message: 'pixels differ' };
    },
    async deliver() {
      deliveries += 1;
      return 'unexpected';
    },
  });
  const outcome = await workflow.run({
    toolId: 'tiff-to-png',
    input: {
      kind: 'file',
      media: {
        name: 'sample.tiff',
        format: 'tiff',
        mimeType: 'image/tiff',
        bytes: fixture('sample.tiff'),
      },
    },
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(deliveries, 0);
});

test('the browser WebM family adds MP4 to WebM through the existing exact contract', async () => {
  const { createHash } = await import('node:crypto');
  assert.deepEqual(BROWSER_WEBM_TOOL_IDS, [
    'compress-webm',
    'mp4-to-webm',
    'webm-to-m4a',
    'webm-to-mp3',
    'webm-to-mp4',
  ]);
  assert.equal(
    createHash('sha256').update(BROWSER_WEBM_TOOL_IDS.join('\n')).digest('hex'),
    'b4aeb75e43e750e8c2ea36b5bf90e0d920f0617c53f4b07be7a88730a3d2053b',
  );
  for (const toolId of BROWSER_WEBM_TOOL_IDS) {
    assert.equal(getGenericToolContract(toolId).state, 'supported', toolId);
    assert.deepEqual(getToolProcessorAvailability(toolId), {
      kind: 'wired',
      toolId,
      adapterId:
        toolId === 'compress-webm'
          ? 'generic-compression'
          : 'generic-conversion',
    });
  }
  for (const toolId of ['webm-to-m4r', 'webm-to-mov', 'webm-to-mpeg']) {
    assert.equal(getGenericToolContract(toolId).state, 'unsupported', toolId);
  }
});

test('Cloudflare-incompatible CR2 dispatches remain truthfully unsupported', () => {
  for (const toolId of [
    'cr2-to-jpeg',
    'cr2-to-jpg',
    'cr2-to-pdf',
    'cr2-to-png',
    'cr2-to-webp',
  ]) {
    assert.equal(getGenericToolContract(toolId).state, 'unsupported', toolId);
    assert.notEqual(getToolProcessorAvailability(toolId).kind, 'wired', toolId);
  }
});

test('generic compression allocates workers from the production dispatch table', () => {
  assert.equal(genericCompressionNeedsWorker('webp'), true);
  assert.equal(genericCompressionNeedsWorker('jpg'), true);
  assert.equal(genericCompressionNeedsWorker('png'), true);
  assert.equal(genericCompressionNeedsWorker('heic'), false);
  assert.equal(genericCompressionNeedsWorker('mp4'), false);
});

test('SVG compression crosses workflow.run through one exact browser contract', async () => {
  const contract = getGenericToolContract('compress-svg');
  assert.deepEqual(contract, {
    state: 'supported',
    toolId: 'compress-svg',
    adapterId: 'generic-compression',
    operation: 'compress',
    input: { format: 'svg', mimeType: 'image/svg+xml' },
    output: { format: 'svg', mimeType: 'image/svg+xml' },
  });
  assert.deepEqual(getToolProcessorAvailability('compress-svg'), {
    kind: 'wired',
    toolId: 'compress-svg',
    adapterId: 'generic-compression',
  });

  const optimized = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#0ea5e9"/><circle cx="60" cy="60" r="32" fill="#f59e0b"/><text x="60" y="66" font-size="18" text-anchor="middle" fill="#111">SVG</text></svg>',
  );
  const boundary = adapters(optimized);
  const outcome = await createGenericToolWorkflow(boundary).run({
    toolId: 'compress-svg',
    input: {
      kind: 'file',
      media: {
        name: 'sample.svg',
        format: 'svg',
        mimeType: 'image/svg+xml',
        bytes: fixture('svg-compression-complex.svg'),
      },
    },
  });

  assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(boundary.processed, ['compress:svg']);
  assert.deepEqual(boundary.delivered, ['sample_compressed.svg']);
});

test('SVG compression names an unchanged original honestly instead of claiming reduction', async () => {
  const original = fixture('svg-compression-complex.svg');
  const boundary = adapters(original);
  const outcome = await createGenericToolWorkflow(boundary).run({
    toolId: 'compress-svg',
    input: {
      kind: 'file',
      media: {
        name: 'sample.svg',
        format: 'svg',
        mimeType: 'image/svg+xml',
        bytes: original,
      },
    },
  });

  assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(boundary.delivered, ['sample_unchanged.svg']);
});

test('SVG compression rejects malformed, spoofed, and active output without delivery', async () => {
  const encoder = new TextEncoder();
  const safeOutput = encoder.encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
  );
  for (const [name, input, output] of [
    [
      'malformed',
      encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'),
      safeOutput,
    ],
    ['spoofed', fixture('sample.png'), safeOutput],
    [
      'active output',
      fixture('svg-compression-complex.svg'),
      encoder.encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    ],
  ] as const) {
    const boundary = adapters(output);
    const outcome = await createGenericToolWorkflow(boundary).run({
      toolId: 'compress-svg',
      input: {
        kind: 'file',
        media: {
          name: 'sample.svg',
          format: 'svg',
          mimeType: 'image/svg+xml',
          bytes: input,
        },
      },
    });
    assert.equal(outcome.status, 'failed', name);
    assert.deepEqual(boundary.delivered, [], name);
    assert.deepEqual(
      boundary.processed,
      name === 'active output' ? ['compress:svg'] : [],
      name,
    );
  }
});

test('SVG compression timeout terminates its registered Worker and never delivers', async () => {
  let terminated = 0;
  const baseBoundary = adapters(fixture('svg-compression-complex.svg'));
  const boundary: GenericWorkflowAdapters = {
    ...baseBoundary,
    async compress({ bytes, context }) {
      const worker = {
        onerror: null,
        onmessage: null,
        postMessage() {},
        terminate() {
          terminated += 1;
        },
      } as unknown as Worker;
      await context.registerWorker(worker);
      return compressSvgWithWorker({
        worker,
        bytes,
        signal: context.signal,
        timeoutMs: 5,
      });
    },
  };
  const outcome = await createGenericToolWorkflow(boundary).run({
    toolId: 'compress-svg',
    input: {
      kind: 'file',
      media: {
        name: 'sample.svg',
        format: 'svg',
        mimeType: 'image/svg+xml',
        bytes: fixture('svg-compression-complex.svg'),
      },
    },
  });

  assert.equal(outcome.status, 'failed');
  assert.equal(terminated, 1);
  assert.deepEqual(baseBoundary.delivered, []);
});

test('SVG compression cancellation terminates its active Worker once and suppresses late output', async () => {
  const controller = new AbortController();
  const terminals: string[] = [];
  let started = false;
  let terminated = 0;
  let workerMessage: Worker['onmessage'] = null;
  const baseBoundary = adapters(fixture('svg-compression-complex.svg'));
  const boundary: GenericWorkflowAdapters = {
    ...baseBoundary,
    async compress({ bytes, context }) {
      const worker = {
        onerror: null,
        get onmessage() {
          return workerMessage;
        },
        set onmessage(value) {
          workerMessage = value;
        },
        postMessage() {
          started = true;
        },
        terminate() {
          terminated += 1;
        },
      } as unknown as Worker;
      await context.registerWorker(worker);
      return compressSvgWithWorker({ worker, bytes, signal: context.signal });
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
      toolId: 'compress-svg',
      input: {
        kind: 'file',
        media: {
          name: 'sample.svg',
          format: 'svg',
          mimeType: 'image/svg+xml',
          bytes: fixture('svg-compression-complex.svg'),
        },
      },
    },
    { signal: controller.signal },
  );
  while (!started) await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  const outcome = await pending;

  assert.equal(outcome.status, 'cancelled');
  assert.equal(terminated, 1);
  assert.equal(workerMessage, null);
  assert.deepEqual(terminals, ['cancelled']);
  assert.deepEqual(baseBoundary.delivered, []);
});

test('SVG file boundary rejects its one-MiB limit before opening the upload stream', async () => {
  let streamsOpened = 0;
  const file = {
    name: 'oversized.svg',
    size: 1_024 * 1_024 + 1,
    type: 'image/svg+xml',
    stream() {
      streamsOpened += 1;
      throw new Error('stream must not be opened');
    },
  } as unknown as File;

  const outcome = await runGenericToolFile('compress-svg', file);
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') {
    assert.equal(outcome.error.code, 'invalid-request');
  }
  assert.equal(streamsOpened, 0);
});

test('contract inventory independently audits real dispatches with semantic coverage', () => {
  const verifiedInputs = new Set([
    'bmp',
    'heic',
    'ico',
    'jpeg',
    'jpg',
    'm4a',
    'mp3',
    'mp4',
    'pdf',
    'png',
    'tif',
    'tiff',
    'webp',
    'webm',
  ]);
  const verifiedOutputs = new Set([
    'jpeg',
    'jpg',
    'm4a',
    'mp3',
    'mp4',
    'pdf',
    'png',
    'webp',
    'webm',
  ]);
  const cloudflareInoperableMediaRoutes = new Set([
    'm4a-to-mp3',
    'mp3-to-m4a',
    'mp4-to-m4a',
    'mp4-to-mp3',
  ]);
  for (const tool of toolCatalog.activeTools.filter(
    (item) =>
      selectToolRenderer(item) === 'generic' && item.operation === 'convert',
  )) {
    if (!tool.from || !tool.to) continue;
    const capability = resolveConversionCapability(tool.from, tool.to);
    const exactTiffFamily = ['tif-to-png', 'tiff-to-png'].includes(tool.id);
    const expectedSupported =
      (exactTiffFamily ||
        (capability.supported &&
          verifiedInputs.has(tool.from) &&
          verifiedOutputs.has(tool.to) &&
          !cloudflareInoperableMediaRoutes.has(tool.id) &&
          ((tool.from !== 'webm' && tool.to !== 'webm') ||
            [
              'mp4-to-webm',
              'webm-to-m4a',
              'webm-to-mp3',
              'webm-to-mp4',
            ].includes(tool.id)) &&
          (tool.from !== 'bmp' ||
            [
              'bmp-to-jpeg',
              'bmp-to-jpg',
              'bmp-to-pdf',
              'bmp-to-png',
              'bmp-to-webp',
            ].includes(tool.id)))) &&
      (!['tif', 'tiff'].includes(tool.from) || exactTiffFamily) &&
      tool.from !== 'ico';
    assert.equal(
      getGenericToolContract(tool.id).state === 'supported',
      expectedSupported,
      `${tool.id}: ${capability.supported ? capability.dispatch.kind : capability.reason}`,
    );
  }
  for (const tool of toolCatalog.activeTools.filter(
    (item) =>
      selectToolRenderer(item) === 'generic' && item.operation === 'compress',
  )) {
    if (!tool.from || !tool.to) continue;
    const dispatch = resolveCompressionDispatch(tool.from);
    const expectedSupported =
      tool.from === tool.to &&
      dispatch.target !== 'unsupported' &&
      dispatch.target !== 'pdf' &&
      verifiedInputs.has(tool.from) &&
      verifiedOutputs.has(tool.to) &&
      !['m4a', 'mp3', 'mp4'].includes(tool.from);
    const exactExpectedSupported =
      (tool.id === 'compress-svg' || expectedSupported) &&
      (tool.from !== 'webm' || tool.id === 'compress-webm');
    assert.equal(
      getGenericToolContract(tool.id).state === 'supported',
      exactExpectedSupported,
      `${tool.id}: ${dispatch.target}`,
    );
  }
});

test('every supported generic contract resolves a processor through workflow.run', async () => {
  const outputFixture = {
    cr2: 'sample.cr2',
    heic: 'sample.heic',
    ico: 'sample.ico',
    jpeg: 'sample.jpg',
    jpg: 'sample.jpg',
    m4a: 'sample.m4a',
    mp3: 'sample.mp3',
    mp4: 'sample.mp4',
    pdf: 'sample.pdf',
    png: 'sample.png',
    svg: 'svg-compression-complex.svg',
    tif: 'sample.tif',
    tiff: 'sample.tiff',
    webp: 'sample.webp',
    webm: 'sample.webm',
  } as const;
  const bmpInspection = inspectBmp(fixture('sample.bmp'));
  assert.equal(bmpInspection.status, 'verified');
  if (bmpInspection.status !== 'verified') return;
  const UPNG = UPNGModule as {
    encode(
      buffers: ArrayBuffer[],
      width: number,
      height: number,
      colors: number,
    ): ArrayBuffer;
  };
  const bmpPdf = await PDFDocument.create();
  const bmpPng = await bmpPdf.embedPng(
    new Uint8Array(
      UPNG.encode(
        [bmpInspection.rgba.slice().buffer],
        bmpInspection.width,
        bmpInspection.height,
        0,
      ),
    ),
  );
  const bmpPage = bmpPdf.addPage([bmpInspection.width, bmpInspection.height]);
  bmpPage.drawImage(bmpPng, {
    x: 0,
    y: 0,
    width: bmpInspection.width,
    height: bmpInspection.height,
  });
  const bmpPdfBytes = await bmpPdf.save();
  const baseBoundary = adapters(fixture('sample.png'));
  const boundary: GenericWorkflowAdapters = {
    ...baseBoundary,
    async convert(request) {
      return [
        request.from === 'bmp' && request.to === 'pdf'
          ? bmpPdfBytes
          : fixture(outputFixture[request.to as keyof typeof outputFixture]),
      ];
    },
    async compress(request) {
      return fixture(
        outputFixture[request.format as keyof typeof outputFixture],
      );
    },
  };
  const inputFixture = {
    bmp: 'sample.bmp',
    cr2: 'sample.cr2',
    heic: 'sample.heic',
    ico: 'sample.ico',
    jpeg: 'sample.jpg',
    jpg: 'sample.jpg',
    m4a: 'sample.m4a',
    mp3: 'sample.mp3',
    mp4: 'sample.mp4',
    pdf: 'sample.pdf',
    png: 'sample.png',
    svg: 'svg-compression-complex.svg',
    tif: 'sample.tif',
    tiff: 'sample.tiff',
    webp: 'sample.webp',
    webm: 'sample.webm',
  } as const;
  const workflowBoundary: GenericWorkflowAdapters = {
    ...boundary,
    async verifyIcoEquivalence() {
      return { status: 'verified' };
    },
    async decodeRaster() {
      return {
        width: bmpInspection.width,
        height: bmpInspection.height,
        rgba: bmpInspection.rgba,
      };
    },
  };
  const workflowWithBmpEvidence = createGenericToolWorkflow(workflowBoundary);
  const supported = toolCatalog.activeTools
    .filter((tool) => selectToolRenderer(tool) === 'generic')
    .map((tool) => getGenericToolContract(tool.id))
    .filter((contract) => contract.state === 'supported');

  for (const contract of supported) {
    const outcome = await workflowWithBmpEvidence.run({
      toolId: contract.toolId,
      input: {
        kind: 'file',
        media: {
          name: `invalid.${contract.input.format}`,
          format: contract.input.format,
          mimeType: contract.input.mimeType,
          bytes: fixture(
            inputFixture[contract.input.format as keyof typeof inputFixture],
          ),
        },
      },
    });
    assert.equal(outcome.status, 'succeeded', contract.toolId);
  }
});

test('a supported generic conversion crosses workflow.run and delivers verified bytes', async () => {
  const boundary = adapters(fixture('sample.jpg'));
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: 'png-to-jpg',
    input: {
      kind: 'file',
      media: {
        name: 'sample.png',
        format: 'png',
        mimeType: 'image/png',
        bytes: fixture('sample.png'),
      },
    },
  });

  assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(boundary.processed, ['png->jpg']);
  assert.deepEqual(boundary.delivered, ['sample.jpg']);
});

test('WebM audio extraction rejects malformed, spoofed, and video-only inputs before FFmpeg', async () => {
  const boundary = adapters(fixture('sample.mp3'));
  const workflow = createGenericToolWorkflow(boundary);
  for (const [name, bytes] of [
    ['malformed.webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])],
    ['spoofed.webm', fixture('sample.mp4')],
    ['video-only.webm', fixture('sample-video-only.webm')],
  ] as const) {
    const outcome = await workflow.run({
      toolId: 'webm-to-mp3',
      input: {
        kind: 'file',
        media: { name, format: 'webm', mimeType: 'video/webm', bytes },
      },
    });
    assert.equal(outcome.status, 'failed', name);
  }
  assert.deepEqual(boundary.processed, []);
  assert.deepEqual(boundary.delivered, []);
});

test('the five WebM Tools validate independent real output semantics before delivery', async () => {
  const outputs = {
    'compress-webm': 'sample.webm',
    'mp4-to-webm': 'sample.webm',
    'webm-to-m4a': 'sample.m4a',
    'webm-to-mp3': 'sample.mp3',
    'webm-to-mp4': 'sample.mp4',
  } as const;
  for (const [toolId, outputName] of Object.entries(outputs)) {
    const boundary = adapters(fixture(outputName));
    const inputFormat = toolId === 'mp4-to-webm' ? 'mp4' : 'webm';
    const outcome = await createGenericToolWorkflow(boundary).run({
      toolId,
      input: {
        kind: 'file',
        media: {
          name: `sample.${inputFormat}`,
          format: inputFormat,
          mimeType: inputFormat === 'mp4' ? 'video/mp4' : 'video/webm',
          bytes: fixture(`sample.${inputFormat}`),
        },
      },
    });
    assert.equal(outcome.status, 'succeeded', toolId);
    assert.equal(boundary.delivered.length, 1, toolId);
  }
});

test('MP4 to WebM rejects spoofed input and wrong-format output without delivery', async () => {
  for (const [input, output] of [
    ['sample.png', 'sample.webm'],
    ['sample.mp4', 'sample.png'],
  ] as const) {
    const boundary = adapters(fixture(output));
    const outcome = await createGenericToolWorkflow(boundary).run({
      toolId: 'mp4-to-webm',
      input: {
        kind: 'file',
        media: {
          name: 'sample.mp4',
          format: 'mp4',
          mimeType: 'video/mp4',
          bytes: fixture(input),
        },
      },
    });
    assert.equal(outcome.status, 'failed', `${input} -> ${output}`);
    assert.deepEqual(boundary.delivered, [], `${input} -> ${output}`);
  }
});

test('the five WebM Tools never deliver malformed or wrong-format output', async () => {
  for (const toolId of BROWSER_WEBM_TOOL_IDS) {
    const boundary = adapters(fixture('sample.png'));
    const inputFormat = toolId === 'mp4-to-webm' ? 'mp4' : 'webm';
    const outcome = await createGenericToolWorkflow(boundary).run({
      toolId,
      input: {
        kind: 'file',
        media: {
          name: `sample.${inputFormat}`,
          format: inputFormat,
          mimeType: inputFormat === 'mp4' ? 'video/mp4' : 'video/webm',
          bytes: fixture(`sample.${inputFormat}`),
        },
      },
    });
    assert.equal(outcome.status, 'failed', toolId);
    assert.deepEqual(boundary.delivered, [], toolId);
  }
});

test('WebM compression rejects valid audio-only WebM output before delivery', async () => {
  const boundary = adapters(fixture('sample-audio-only.webm'));
  const outcome = await createGenericToolWorkflow(boundary).run({
    toolId: 'compress-webm',
    input: {
      kind: 'file',
      media: {
        name: 'sample.webm',
        format: 'webm',
        mimeType: 'video/webm',
        bytes: fixture('sample.webm'),
      },
    },
  });

  assert.equal(outcome.status, 'failed');
  assert.deepEqual(boundary.delivered, []);
});

test('WebM cancellation cleans its worker, emits one terminal, and never delivers', async () => {
  const controller = new AbortController();
  const terminals: string[] = [];
  let terminated = 0;
  let started = false;
  const baseBoundary = adapters(fixture('sample.mp3'));
  const boundary: GenericWorkflowAdapters = {
    ...baseBoundary,
    async convert({ context }) {
      await context.registerWorker({
        terminate() {
          terminated += 1;
        },
      } as Worker);
      started = true;
      return await new Promise<readonly Uint8Array[]>((_resolve, reject) => {
        context.signal.addEventListener(
          'abort',
          () => reject(context.signal.reason),
          {
            once: true,
          },
        );
      });
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
      toolId: 'webm-to-mp3',
      input: {
        kind: 'file',
        media: {
          name: 'sample.webm',
          format: 'webm',
          mimeType: 'video/webm',
          bytes: fixture('sample.webm'),
        },
      },
    },
    { signal: controller.signal },
  );
  while (!started) await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  const outcome = await pending;
  assert.equal(outcome.status, 'cancelled');
  assert.equal(terminated, 1);
  assert.deepEqual(terminals, ['cancelled']);
  assert.deepEqual(baseBoundary.delivered, []);
});

test('runtime capability rejection fails closed before a registered engine runs', async () => {
  const baseBoundary = adapters(fixture('sample.jpg'));
  const boundary: GenericWorkflowAdapters = {
    ...baseBoundary,
    decideSupport() {
      return { supported: false, message: 'Runtime adapter unavailable' };
    },
  };
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: 'png-to-jpg',
    input: {
      kind: 'file',
      media: {
        name: 'sample.png',
        format: 'png',
        mimeType: 'image/png',
        bytes: fixture('sample.png'),
      },
    },
  });

  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') {
    assert.equal(outcome.error.code, 'unsupported-request');
  }
  assert.deepEqual(baseBoundary.processed, []);
  assert.deepEqual(baseBoundary.delivered, []);
});

test('production support rejects media work when no deployable browser runtime exists', () => {
  assert.deepEqual(
    decideGenericBrowserSupport(
      { operation: 'convert', inputFormat: 'mp4', outputFormat: 'm4a' },
      false,
    ),
    {
      supported: false,
      message: 'Media processing is not available in this browser.',
    },
  );
  assert.deepEqual(
    decideGenericBrowserSupport(
      { operation: 'compress', inputFormat: 'mp4', outputFormat: 'mp4' },
      false,
    ),
    {
      supported: false,
      message: 'Media processing is not available in this browser.',
    },
  );
  assert.deepEqual(
    decideGenericBrowserSupport(
      { operation: 'compress', inputFormat: 'mp3', outputFormat: 'mp3' },
      false,
    ),
    {
      supported: false,
      message: 'Media processing is not available in this browser.',
    },
  );
});

test('a PNG fallback cannot succeed for a requested non-PNG output', async () => {
  const boundary = adapters(fixture('sample.png'));
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: 'png-to-jpg',
    input: {
      kind: 'file',
      media: {
        name: 'sample.png',
        format: 'png',
        mimeType: 'image/png',
        bytes: fixture('sample.png'),
      },
    },
  });

  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed')
    assert.equal(outcome.error.code, 'invalid-result');
  assert.deepEqual(boundary.delivered, []);
});

test('browser image decoding cannot legitimize wrong-format bytes', async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () =>
    ({ width: 1, height: 1, close() {} }) as ImageBitmap;
  try {
    const verification = await verifyGenericMediaSemantics({
      name: 'renamed.jpg',
      format: 'jpg',
      mimeType: 'image/jpeg',
      bytes: fixture('sample.png'),
    });
    assert.equal(verification.status, 'rejected');
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('a browser with image interfaces but no BMP codec returns the exact safe unsupported outcome', async () => {
  const originalImageDecoder = (globalThis as { ImageDecoder?: unknown })
    .ImageDecoder;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  class UnsupportedBmpDecoder {
    decode() {
      return Promise.reject(
        new DOMException('unsupported', 'NotSupportedError'),
      );
    }
    close() {}
  }
  (globalThis as { ImageDecoder?: unknown }).ImageDecoder =
    UnsupportedBmpDecoder;
  globalThis.createImageBitmap = async () => {
    throw new DOMException('unsupported', 'NotSupportedError');
  };
  try {
    const outcome = await runGenericToolFile(
      'bmp-to-png',
      new File([fixture('sample.bmp')], 'sample.bmp', { type: 'image/bmp' }),
    );
    assert.equal(outcome.status, 'failed');
    if (outcome.status === 'failed') {
      assert.equal(outcome.error.code, 'unsupported-request');
      assert.equal(
        outcome.error.message,
        'BMP conversion is not available in this browser.',
      );
      assert.equal(outcome.telemetry.start, 'not-attempted');
    }
  } finally {
    (globalThis as { ImageDecoder?: unknown }).ImageDecoder =
      originalImageDecoder;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('exact WebP identity rejects PNG bytes before browser decoding', async () => {
  const verification = await verifyGenericMediaSemantics({
    name: 'renamed.webp',
    format: 'webp',
    mimeType: 'image/webp',
    bytes: fixture('sample.png'),
  });
  assert.equal(verification.status, 'rejected');
});

test('exact MP3 identity rejects WAV bytes before AudioContext decoding', async () => {
  for (const bytes of [
    fixture('sample.wav'),
    new Uint8Array([
      0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x10, 0xc4, 0xff, 0xfb,
      0x10, 0xc4,
    ]),
  ]) {
    const verification = await verifyGenericMediaSemantics({
      name: 'renamed.mp3',
      format: 'mp3',
      mimeType: 'audio/mpeg',
      bytes,
    });
    assert.equal(verification.status, 'rejected');
  }
});

test('generic file acquisition canonicalizes safe MIME aliases and derives octet-stream identity from bytes', async () => {
  for (const type of ['image/x-png', 'application/octet-stream']) {
    const file = new File([fixture('sample.png')], 'sample.png', { type });
    const outcome = await runGenericToolFile('png-to-jpg', file);
    assert.equal(outcome.status, 'failed', type);
    if (outcome.status === 'failed') {
      assert.notEqual(outcome.error.code, 'unsupported-input', type);
    }
  }
  const renamed = new File([fixture('sample.wav')], 'renamed.mp4', {
    type: 'application/octet-stream',
  });
  const outcome = await runGenericToolFile('mp4-to-mp3', renamed);
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed')
    assert.equal(outcome.error.code, 'unsupported-tool');
});

test('trusted byte identity distinguishes HEIC, M4A, and MP4 families', async () => {
  const heifGlobal = globalThis as typeof globalThis & {
    HeifContext?: new () => unknown;
  };
  heifGlobal.HeifContext = class {
    read() {}
    getPrimaryImageHandle() {
      return {
        decode() {
          throw new Error('identity detection must not decode pixels');
        },
        get_width: () => 1,
        get_height: () => 1,
        free() {},
      };
    }
    free() {}
  } as never;

  assert.equal(
    await detectGenericMediaMimeType(fixture('sample.heic')),
    'image/heic',
  );
  assert.equal(
    await detectGenericMediaMimeType(fixture('sample.m4a')),
    'audio/mp4',
  );
  assert.equal(
    await detectGenericMediaMimeType(fixture('sample.mp4')),
    'video/mp4',
  );
  assert.equal(
    await detectGenericMediaMimeType(fixture('sample.avif')),
    undefined,
  );
});

test('empty and octet-stream MIME use trusted HEIC identity before workflow support', async () => {
  for (const type of ['', 'application/octet-stream']) {
    const outcome = await runGenericToolFile(
      'heic-to-jpg',
      new File([fixture('sample.heic')], 'sample.heic', { type }),
    );
    assert.equal(outcome.status, 'failed');
    if (outcome.status === 'failed') {
      assert.notEqual(outcome.error.code, 'unsupported-request', type);
    }
  }
});

test('browser image decoder cancellation rejects promptly and closes the decoder', async () => {
  const originalImageDecoder = (globalThis as { ImageDecoder?: unknown })
    .ImageDecoder;
  let closed = false;
  class StalledImageDecoder {
    decode() {
      return new Promise<never>(() => {});
    }
    close() {
      closed = true;
    }
  }
  (globalThis as { ImageDecoder?: unknown }).ImageDecoder = StalledImageDecoder;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const started = performance.now();
  try {
    await assert.rejects(
      decodeToRGBA(
        'webp',
        fixture('sample.webp').slice().buffer,
        controller.signal,
      ),
      (error: unknown) =>
        error instanceof DOMException && error.name === 'AbortError',
    );
  } finally {
    (globalThis as { ImageDecoder?: unknown }).ImageDecoder =
      originalImageDecoder;
  }
  assert.ok(performance.now() - started < 150);
  assert.equal(closed, true);
});

test('main-thread HEIC conversion propagates cancellation to libheif', async () => {
  const originalImageData = globalThis.ImageData;
  const heifGlobal = globalThis as typeof globalThis & {
    HeifContext?: new () => unknown;
  };
  let freed = 0;
  globalThis.ImageData = class {
    constructor() {}
  } as never;
  heifGlobal.HeifContext = class {
    read() {}
    getPrimaryImageHandle() {
      return {
        decode() {
          return {
            get_width: () => 1,
            get_height: () => 1,
            display() {},
            free() {
              freed += 1;
            },
          };
        },
        free() {
          freed += 1;
        },
      };
    }
    free() {
      freed += 1;
    }
  } as never;
  const controller = new AbortController();
  const worker = { terminate() {}, postMessage() {} } as unknown as Worker;
  setTimeout(() => controller.abort(), 10);
  const started = performance.now();
  try {
    await assert.rejects(
      convertWithWorker({
        worker,
        from: 'heic',
        to: 'jpg',
        buf: fixture('sample.heic').slice().buffer,
        signal: controller.signal,
      }),
      (error: unknown) =>
        error instanceof DOMException && error.name === 'AbortError',
    );
  } finally {
    globalThis.ImageData = originalImageData;
  }
  assert.ok(performance.now() - started < 150);
  assert.equal(freed, 0);
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(freed, 3);
});

test('unsupported media compression fails before constructing an audio decoder', async () => {
  const originalAudioContext = globalThis.AudioContext;
  let constructed = 0;
  class StalledAudioContext {
    constructor() {
      constructed += 1;
    }
    decodeAudioData() {
      return new Promise<never>(() => {});
    }
    async close() {}
  }
  globalThis.AudioContext = StalledAudioContext as never;
  try {
    const outcome = await runGenericToolFile(
      'compress-mp3',
      new File([fixture('sample.mp3')], 'sample.mp3', { type: 'audio/mp3' }),
    );
    assert.equal(outcome.status, 'failed');
    if (outcome.status === 'failed')
      assert.equal(outcome.error.code, 'unsupported-tool');
  } finally {
    globalThis.AudioContext = originalAudioContext;
  }
  assert.equal(constructed, 0);
});

test('native JPEG fallback reapplies dimension and aggregate RGBA limits', async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const jpegEnvelope = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  try {
    for (const [width, height] of [
      [100_000, 100_000],
      [8_192, 2_049],
    ]) {
      let closed = false;
      globalThis.createImageBitmap = async () =>
        ({
          width,
          height,
          close() {
            closed = true;
          },
        }) as ImageBitmap;
      const verification = await verifyGenericMediaSemantics({
        name: 'bomb.jpg',
        format: 'jpg',
        mimeType: 'image/jpeg',
        bytes: jpegEnvelope,
      });
      assert.equal(verification.status, 'rejected', `${width}x${height}`);
      assert.equal(closed, true, `${width}x${height} bitmap was not closed`);
    }
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('browser delivery delays Blob URL revocation until the download has started', async () => {
  const revoked: string[] = [];
  const clicks: string[] = [];
  let cleanup: (() => void) | undefined;
  let delay = 0;
  const deliveryId = await deliverBrowserMedia(
    {
      name: 'result.png',
      format: 'png',
      mimeType: 'image/png',
      bytes: fixture('sample.png'),
    },
    {
      createObjectUrl: () => 'blob:result',
      revokeObjectUrl: (url) => revoked.push(url),
      clickDownload: (url, name) => clicks.push(`${url}:${name}`),
      scheduleCleanup(callback, delayMs) {
        cleanup = callback;
        delay = delayMs;
      },
      nextId: () => 'delivery-1',
    },
  );
  assert.equal(deliveryId, 'delivery-1');
  assert.deepEqual(clicks, ['blob:result:result.png']);
  assert.deepEqual(revoked, []);
  assert.equal(delay, 1_000);
  cleanup?.();
  assert.deepEqual(revoked, ['blob:result']);
});

test('a superseded run cannot clear or overwrite its active replacement', async () => {
  type Resolve = (
    outcome: Awaited<ReturnType<typeof runGenericToolFile>>,
  ) => void;
  const pending = new Map<string, Resolve>();
  const states: Array<Record<string, unknown>> = [];
  let state: Record<string, unknown> = {};
  const controller = createGenericToolRunController({
    runFile(_toolId, file) {
      return new Promise((resolve) => pending.set(file.name, resolve));
    },
    publish(patch) {
      state = { ...state, ...patch };
      states.push(state);
    },
    failureMessage: () => 'failed',
    completionMessage: () => 'complete',
  });
  const first = controller.run({
    toolId: 'png-to-jpg',
    files: [{ name: 'slow.png' } as File],
  });
  const second = controller.run({
    toolId: 'png-to-jpg',
    files: [{ name: 'active.png' } as File],
  });
  pending.get('active.png')?.({
    status: 'succeeded',
    runId: 'active',
    results: [],
    telemetry: { start: 'submitted', terminal: 'submitted' },
  });
  await second;
  const settledReplacement = { ...state };
  pending.get('slow.png')?.({
    status: 'cancelled',
    runId: 'slow',
    telemetry: { start: 'submitted', terminal: 'submitted' },
  });
  await first;
  assert.deepEqual(state, settledReplacement);
  assert.equal(state.busy, false);
  assert.equal((state.currentFile as { name: string }).name, 'active.png');
  assert.equal(states.at(-1)?.busy, false);
});

test('an active ICO Worker is terminated when a replacement run supersedes it', async () => {
  type RawWorker = {
    onmessage: Worker['onmessage'];
    onerror: Worker['onerror'];
    postMessage(): void;
    terminate(): void;
  };
  const states: Array<Record<string, unknown>> = [];
  const terminations = [0, 0];
  const rawWorkers: RawWorker[] = [];
  const controller = createGenericToolRunController({
    async runFile(_toolId, file, options) {
      const index = rawWorkers.length;
      const rawWorker: RawWorker = {
        onmessage: null,
        onerror: null,
        postMessage() {
          if (index !== 1) return;
          queueMicrotask(() =>
            rawWorker.onmessage?.call(
              rawWorker as unknown as Worker,
              {
                data: {
                  ok: true,
                  png: Uint8Array.from(fixture('sample.png')).buffer,
                  width: 96,
                  height: 96,
                  selectedIndex: 0,
                  sourceKind: 'dib',
                  pixelVerified: true,
                },
              } as MessageEvent,
            ),
          );
        },
        terminate() {
          terminations[index] = (terminations[index] ?? 0) + 1;
        },
      };
      rawWorkers.push(rawWorker);
      try {
        await convertIcoToPngWithWorker({
          worker: ownWorkerTermination(rawWorker as unknown as Worker),
          bytes: fixture('sample.ico'),
          signal: options.signal,
        });
        return {
          status: 'succeeded' as const,
          runId: file.name,
          results: [],
          telemetry: {
            start: 'submitted' as const,
            terminal: 'submitted' as const,
          },
        };
      } catch (error) {
        if (options.signal.aborted) {
          return {
            status: 'cancelled' as const,
            runId: file.name,
            telemetry: {
              start: 'submitted' as const,
              terminal: 'submitted' as const,
            },
          };
        }
        throw error;
      }
    },
    publish(patch) {
      states.push({ ...(states.at(-1) ?? {}), ...patch });
    },
    failureMessage: () => 'failed',
    completionMessage: () => 'complete',
  });

  const first = controller.run({
    toolId: 'ico-to-png',
    files: [{ name: 'slow.ico' } as File],
  });
  while (rawWorkers.length < 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
  const firstLateMessage = rawWorkers[0]!.onmessage;
  const second = controller.run({
    toolId: 'ico-to-png',
    files: [{ name: 'replacement.ico' } as File],
  });
  await Promise.all([first, second]);
  const settledReplacement = { ...states.at(-1) };
  firstLateMessage?.call(
    rawWorkers[0]! as unknown as Worker,
    {
      data: {
        ok: true,
        png: Uint8Array.from(fixture('sample.png')).buffer,
        width: 96,
        height: 96,
        selectedIndex: 0,
        sourceKind: 'dib',
        pixelVerified: true,
      },
    } as MessageEvent,
  );

  assert.deepEqual(terminations, [1, 0]);
  assert.deepEqual(states.at(-1), settledReplacement);
  assert.equal(states.at(-1)?.busy, false);
  assert.equal(
    (states.at(-1)?.currentFile as { name: string }).name,
    'replacement.ico',
  );
});

test('FFmpeg production lifecycle releases listeners and files after every failure stage', async () => {
  for (const stage of ['write', 'exec', 'read'] as const) {
    const deleted: string[] = [];
    let attached = 0;
    let detached = 0;
    let terminated = 0;
    const controller = new AbortController();
    const progress = () => {};
    const adapter = {
      async writeFile() {
        if (stage === 'write') throw new Error('write failed');
      },
      async deleteFile(name: string) {
        deleted.push(name);
      },
      on() {
        attached += 1;
      },
      off() {
        detached += 1;
      },
      terminate() {
        terminated += 1;
      },
    };
    await assert.rejects(
      runFfmpegLifecycle(
        adapter,
        {
          inputs: [{ name: 'input.mp4', data: new Uint8Array([1]) }],
          cleanupFiles: ['output.mp3', 'palette.png'],
          signal: controller.signal,
          progress,
        },
        async () => {
          if (stage === 'exec') throw new Error('exec failed');
          throw new Error('read failed');
        },
      ),
      new RegExp(`${stage} failed`),
    );
    assert.equal(attached, 1, stage);
    assert.equal(detached, 1, stage);
    assert.deepEqual(
      deleted,
      ['input.mp4', 'output.mp3', 'palette.png'],
      stage,
    );
    controller.abort();
    assert.equal(terminated, 0, `${stage} retained abort listener`);
  }
});

test('an unsupported generic route fails closed before its legacy raster fallback', async () => {
  const boundary = adapters(fixture('sample.png'));
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: '3g2-to-mp4',
    input: {
      kind: 'file',
      media: {
        name: 'sample.3g2',
        format: '3g2',
        mimeType: 'video/3gpp2',
        bytes: fixture('sample.3g2'),
      },
    },
  });

  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed')
    assert.equal(outcome.error.code, 'unsupported-tool');
  assert.deepEqual(boundary.processed, []);
  assert.deepEqual(boundary.delivered, []);
});

test('generic family semantic validation accepts real image, media, audio, and PDF fixtures', async () => {
  const cases = [
    ['png', 'image/png', 'sample.png'],
    ['jpg', 'image/jpeg', 'sample.jpg'],
    ['mp4', 'video/mp4', 'sample.mp4'],
    ['m4a', 'audio/mp4', 'sample.m4a'],
    ['pdf', 'application/pdf', 'sample.pdf'],
  ] as const;

  for (const [format, mimeType, name] of cases) {
    assert.deepEqual(
      await verifyGenericMediaSemantics({
        name,
        format,
        mimeType,
        bytes: fixture(name),
      }),
      { status: 'verified' },
      format,
    );
  }
});

test('trusted media parsers reject truncated and fabricated BMFF audio', async () => {
  const source = fixture('sample.m4a');
  for (const bytes of [
    source.subarray(0, Math.min(32, source.byteLength)),
    new Uint8Array([
      0, 0, 0, 16, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0, 0, 0, 0, 8,
      109, 111, 111, 118,
    ]),
  ]) {
    const result = await verifyGenericMediaSemantics({
      name: 'fake.m4a',
      format: 'm4a',
      mimeType: 'audio/mp4',
      bytes,
    });
    assert.equal(result.status, 'rejected');
  }
});

test('Cloudflare-inoperable BMFF contracts fail before processing or delivery', async () => {
  const cases = [
    {
      toolId: 'mp4-to-m4a',
      input: 'sample.mp4',
      output: 'sample.mp4',
      expectedProcessed: false,
    },
    {
      toolId: 'compress-mp4',
      input: 'sample.m4a',
      output: 'sample.m4a',
      expectedProcessed: false,
    },
    {
      toolId: 'compress-m4a',
      input: 'sample.m4a',
      output: 'sample.mp4',
      expectedProcessed: false,
    },
  ] as const;

  for (const testCase of cases) {
    const boundary = adapters(fixture(testCase.output));
    const workflow = createGenericToolWorkflow(boundary);
    const contract = getGenericToolContract(testCase.toolId);
    assert.equal(contract.state, 'unsupported');
    const outcome = await workflow.run({
      toolId: testCase.toolId,
      input: {
        kind: 'file',
        media: {
          name: testCase.input,
          format: testCase.input.split('.').at(-1) ?? 'unknown',
          mimeType: testCase.input.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4',
          bytes: fixture(testCase.input),
        },
      },
    });

    assert.equal(outcome.status, 'failed', testCase.toolId);
    assert.equal(boundary.processed.length > 0, testCase.expectedProcessed);
    assert.deepEqual(boundary.delivered, []);
  }
});

test('MP4 compression cannot silently discard a valid input audio track', async () => {
  const boundary = adapters(mp4WithoutRecognizedAudioTrack());
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: 'compress-mp4',
    input: {
      kind: 'file',
      media: {
        name: 'sample.mp4',
        format: 'mp4',
        mimeType: 'video/mp4',
        bytes: fixture('sample.mp4'),
      },
    },
  });

  assert.equal(outcome.status, 'failed');
  assert.deepEqual(boundary.delivered, []);
});

test('file preflight rejects oversized input without reading it', async () => {
  let reads = 0;
  const file = {
    name: 'oversized.png',
    type: 'image/png',
    size: 256 * 1_024 * 1_024 + 1,
    async arrayBuffer() {
      reads += 1;
      throw new Error('must not read');
    },
  } as unknown as File;

  const outcome = await runGenericToolFile('png-to-jpg', file);
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed')
    assert.equal(outcome.error.code, 'invalid-request');
  assert.equal(reads, 0);
});

test('TIFF file preflight applies the family limit before reading', async () => {
  let reads = 0;
  const file = {
    name: 'oversized.tiff',
    type: 'image/tiff',
    size: 32 * 1_024 * 1_024 + 1,
    async arrayBuffer() {
      reads += 1;
      throw new Error('must not read');
    },
  } as unknown as File;

  const outcome = await runGenericToolFile('tiff-to-png', file);
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed')
    assert.equal(outcome.error.code, 'invalid-request');
  assert.equal(reads, 0);
});

test('unregistered ICO route fails closed before reading candidate bytes', async () => {
  let reads = 0;
  const file = {
    name: 'oversized.ico',
    type: 'image/x-icon',
    size: 16 * 1_024 * 1_024 + 1,
    async arrayBuffer() {
      reads += 1;
      throw new Error('must not read');
    },
  } as unknown as File;

  const outcome = await runGenericToolFile('ico-to-png', file);
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') {
    assert.equal(outcome.error.code, 'unsupported-tool');
  }
  assert.equal(reads, 0);
});

test('file acquisition cancellation returns promptly and cancels its reader', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const file = {
    name: 'slow.png',
    type: 'image/png',
    size: 8,
    stream() {
      return new ReadableStream<Uint8Array>({
        async pull(streamController) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          streamController.enqueue(new Uint8Array(8));
          streamController.close();
        },
        cancel() {
          cancelled = true;
        },
      });
    },
  } as unknown as File;
  setTimeout(() => controller.abort(), 10);
  const started = performance.now();

  const outcome = await runGenericToolFile('png-to-jpg', file, {
    signal: controller.signal,
  });

  assert.equal(outcome.status, 'cancelled');
  assert.ok(
    performance.now() - started < 150,
    'cancellation waited for the delayed read',
  );
  assert.equal(cancelled, true);
});

test('TIFF picker accepts both conventional extensions', () => {
  assert.equal(getGenericAccept('tiff'), '.tif,.tiff');
  assert.equal(getGenericAccept('tif'), '.tif,.tiff');
});

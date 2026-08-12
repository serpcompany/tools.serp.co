import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import {
  BATCH_PNG_IMPLEMENTATION_LIMITS,
  BATCH_PNG_LIMITS,
  createBatchToolWorkflow,
  getBatchToolContract,
  type BatchCompressionPort,
} from './batch-tool-workflow.ts';
import {
  createBatchRunController,
  retainBatchAggregateProgress,
} from './batch-browser-workflow.ts';
import type {
  ToolWorkflow,
  WorkflowMedia,
  WorkflowSnapshot,
} from './tool-workflow/index.ts';
import { getToolProcessorAvailability } from './tool-processor-registry.ts';

const sample = new Uint8Array(
  readFileSync(new URL('../benchmarks/fixtures/sample.png', import.meta.url)),
);
const sample2 = new Uint8Array(
  readFileSync(new URL('../benchmarks/fixtures/sample-2.png', import.meta.url)),
);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngWithTextPayload(source: Uint8Array, payloadBytes: number) {
  const iendOffset = source.byteLength - 12;
  const chunk = new Uint8Array(12 + payloadBytes);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payloadBytes, false);
  chunk.set(new TextEncoder().encode('tEXt'), 4);
  chunk.fill(97, 8, 8 + payloadBytes);
  view.setUint32(
    8 + payloadBytes,
    crc32(chunk.subarray(4, 8 + payloadBytes)),
    false,
  );
  const result = new Uint8Array(source.byteLength + chunk.byteLength);
  result.set(source.subarray(0, iendOffset));
  result.set(chunk, iendOffset);
  result.set(source.subarray(iendOffset), iendOffset + chunk.byteLength);
  return result;
}

function png(name: string, bytes = sample): WorkflowMedia {
  return { name, format: 'png', mimeType: 'image/png', bytes };
}

function batch(media: readonly WorkflowMedia[]) {
  return {
    kind: 'batch' as const,
    items: media.map((item) => ({
      name: item.name,
      format: item.format,
      mimeType: item.mimeType,
      size: item.bytes.byteLength,
      stream: () => new Blob([Uint8Array.from(item.bytes)]).stream(),
    })),
  };
}

function recorder(
  compress: BatchCompressionPort = async ({ bytes }) => Uint8Array.from(bytes),
) {
  const deliveries: WorkflowMedia[] = [];
  const telemetry: string[] = [];
  let sequence = 0;
  return {
    deliveries,
    telemetry,
    workflow: createBatchToolWorkflow({
      compress,
      async deliver(media) {
        deliveries.push(media);
        return `delivery-${deliveries.length}`;
      },
      telemetry: {
        async start() {
          telemetry.push('start');
        },
        async terminal(_runId, status) {
          telemetry.push(`terminal:${status}`);
        },
      },
      nextId(kind) {
        sequence += 1;
        return `${kind}-${sequence}`;
      },
      clock: { now: () => 1_700_000_000_000 },
    }),
  };
}

async function archiveEntries(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries = await reader.getEntries();
    return await Promise.all(
      entries.map(async (entry) => ({
        name: entry.filename,
        bytes:
          'getData' in entry
            ? await entry.getData(new Uint8ArrayWriter())
            : new Uint8Array(),
      })),
    );
  } finally {
    await reader.close();
  }
}

test('batch contract owns the exact active portfolio and explicit fail-fast policy', () => {
  assert.deepEqual(getBatchToolContract('batch-compress-png'), {
    state: 'supported',
    toolId: 'batch-compress-png',
    adapterId: 'browser-batch-png-workflow',
    primaryOperation: {
      class: 'library',
      identity: '@jsquash/oxipng 1 and @zip.js/zip.js 2',
      rationale:
        'Oxipng owns PNG compression and zip.js owns ordered ZIP encoding and decoding; repository policy only bounds and validates the batch.',
    },
  });
  assert.equal(getBatchToolContract('png-compress').state, 'unsupported');
  assert.deepEqual(getToolProcessorAvailability('batch-compress-png'), {
    kind: 'wired',
    toolId: 'batch-compress-png',
    adapterId: 'browser-batch-png-workflow',
  });
});

test('batch presentation delegates processing, telemetry, delivery resources, and cleanup policy', () => {
  const source = readFileSync(
    new URL('../components/BatchHeroConverter.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /createBrowserBatchWorkflow/);
  assert.match(source, /createBatchRunController/);
  assert.doesNotMatch(
    source,
    /new Worker|compressPngWithWorker|beginToolRun|finishSuccess|finishFailure|saveBlob|createObjectURL|revokeObjectURL|terminate\(/,
  );
  assert.match(source, /void controller\.runFiles\(/);
  assert.doesNotMatch(source, /if\s*\(!outcome\)\s*setBusy\(false\)/);
});

test('phase-only presentation snapshots preserve monotonic aggregate progress', () => {
  const processing = { phase: 'processing' as const, progress: 0.7 };
  const validating = retainBatchAggregateProgress(processing, {
    phase: 'validating',
  });
  const delivering = retainBatchAggregateProgress(validating, {
    phase: 'delivering',
  });
  assert.equal(validating.progress, 0.7);
  assert.equal(delivering.progress, 0.7);
});

test('workflow.run emits one telemetry run and delivers an ordered, named, semantically valid archive', async () => {
  const calls: string[] = [];
  const { workflow, deliveries, telemetry } = recorder(
    async ({ name, bytes, reportProgress }) => {
      calls.push(name);
      reportProgress(0.5);
      reportProgress(1);
      return Uint8Array.from(bytes);
    },
  );
  const snapshots: WorkflowSnapshot[] = [];

  const outcome = await workflow.run(
    {
      toolId: 'batch-compress-png',
      input: batch([png('zeta.png'), png('alpha.PNG', sample2)]),
      options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
    },
    { observe: (snapshot) => snapshots.push(snapshot) },
  );

  assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(calls, ['zeta.png', 'alpha.PNG']);
  assert.deepEqual(telemetry, ['start', 'terminal:succeeded']);
  assert.equal(deliveries.length, 1);
  assert.deepEqual(
    outcome.status === 'succeeded'
      ? outcome.results.map(({ name, format, mimeType }) => ({
          name,
          format,
          mimeType,
        }))
      : [],
    [
      {
        name: 'compressed_pngs.zip',
        format: 'zip',
        mimeType: 'application/zip',
      },
    ],
  );
  const entries = await archiveEntries(deliveries[0]!.bytes);
  assert.deepEqual(
    entries.map(({ name }) => name),
    ['zeta_compressed.png', 'alpha_compressed.png'],
  );
  assert.deepEqual(
    entries.map(({ bytes }) => bytes.byteLength),
    [sample.byteLength, sample2.byteLength],
  );
  const itemSnapshots = snapshots.filter(
    ({ phase, item }) => phase === 'processing' && item,
  );
  assert.equal(
    itemSnapshots[0]!.item!.progress,
    undefined,
    'indeterminate item progress stays omitted',
  );
  assert.ok(
    itemSnapshots.every(
      ({ progress }, index, all) =>
        index === 0 || progress! >= all[index - 1]!.progress!,
    ),
  );
  assert.equal(itemSnapshots.at(-1)!.item!.progress, 1);
});

test('batch inputs fail closed on cardinality, order-name collisions, format spoofing, and bounded bytes before telemetry', async () => {
  const sharedNineMiB = new Uint8Array(9 * 1_024 * 1_024);
  for (const media of [
    [],
    Array.from({ length: BATCH_PNG_LIMITS.maxItems + 1 }, (_, index) =>
      png(`${index}.png`),
    ),
    [png('../same.png'), png('same.png')],
    [png('fake.jpg')],
    [png('oversize.png', new Uint8Array(BATCH_PNG_LIMITS.maxItemBytes + 1))],
    Array.from({ length: 8 }, (_, index) => png(`${index}.png`, sharedNineMiB)),
  ]) {
    const { workflow, telemetry, deliveries } = recorder();
    const outcome = await workflow.run({
      toolId: 'batch-compress-png',
      input: batch(media),
      options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
    });
    assert.equal(outcome.status, 'failed');
    assert.deepEqual(telemetry, []);
    assert.deepEqual(deliveries, []);
  }
});

test('a compressor returning spoofed PNG bytes cannot reach archive delivery', async () => {
  const { workflow, deliveries, telemetry } = recorder(async () =>
    new TextEncoder().encode('not a png'),
  );
  const outcome = await workflow.run({
    toolId: 'batch-compress-png',
    input: batch([png('one.png')]),
    options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
  });
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(deliveries, []);
  assert.deepEqual(telemetry, ['start', 'terminal:failed']);
});

test('a larger malformed compressor candidate cannot be hidden by retaining the original', async () => {
  const malformed = new Uint8Array(sample.byteLength + 1_024);
  const { workflow, deliveries, telemetry } = recorder(async () => malformed);
  const outcome = await workflow.run({
    toolId: 'batch-compress-png',
    input: batch([png('one.png')]),
    options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
  });
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(deliveries, []);
  assert.deepEqual(telemetry, ['start', 'terminal:failed']);
});

test('oversized intermediate compressor candidate is rejected before semantic parsing, archive, or delivery and cleans up', async () => {
  let cleanups = 0;
  const { workflow, deliveries, telemetry } = recorder(
    async ({ registerCleanup }) => {
      await registerCleanup(async () => {
        cleanups += 1;
      });
      return new Uint8Array(
        BATCH_PNG_IMPLEMENTATION_LIMITS.maxCompressionCandidateBytes + 1,
      );
    },
  );
  const outcome = await workflow.run({
    toolId: 'batch-compress-png',
    input: batch([png('one.png')]),
    options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
  });
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') {
    assert.match(outcome.error.message, /intermediate compressor candidate/i);
  }
  assert.equal(cleanups, 1);
  assert.deepEqual(deliveries, []);
  assert.deepEqual(telemetry, ['start', 'terminal:failed']);
});

test('workflow keeps original PNG bytes when compression would be larger', async () => {
  const larger = pngWithTextPayload(sample, 1_024);
  const { workflow, deliveries } = recorder(async () => larger);
  const outcome = await workflow.run({
    toolId: 'batch-compress-png',
    input: batch([png('one.png')]),
    options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
  });
  assert.equal(outcome.status, 'succeeded');
  const entries = await archiveEntries(deliveries[0]!.bytes);
  assert.deepEqual(entries[0]!.bytes, sample);
});

test('workflow keeps a valid original when a structurally valid compressor candidate expands beyond the per-item limit', async () => {
  const expanded = pngWithTextPayload(sample, 17 * 1_024 * 1_024);
  const { workflow, deliveries } = recorder(async () => expanded);
  const outcome = await workflow.run({
    toolId: 'batch-compress-png',
    input: batch([png('one.png')]),
    options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
  });
  assert.equal(outcome.status, 'succeeded');
  const entries = await archiveEntries(deliveries[0]!.bytes);
  assert.deepEqual(entries[0]!.bytes, sample);
});

test('declared aggregate budget rejects before compression, archive build, telemetry, or delivery', async () => {
  const largePng = pngWithTextPayload(sample, 13 * 1_024 * 1_024);
  let cleanups = 0;
  let calls = 0;
  const { workflow, deliveries, telemetry } = recorder(
    async ({ bytes, registerCleanup }) => {
      calls += 1;
      await registerCleanup(async () => {
        cleanups += 1;
      });
      return bytes;
    },
  );
  const outcome = await workflow.run({
    toolId: 'batch-compress-png',
    input: batch(
      Array.from({ length: 4 }, (_, index) => png(`${index}.png`, largePng)),
    ),
    options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(calls, 0);
  assert.equal(cleanups, 0);
  assert.deepEqual(deliveries, []);
  assert.deepEqual(telemetry, []);
});

test('fail-fast partial-success policy never converts a non-empty prefix into success', async () => {
  let calls = 0;
  const { workflow, deliveries, telemetry } = recorder(async ({ bytes }) => {
    calls += 1;
    if (calls === 2) throw new Error('second item failed');
    return Uint8Array.from(bytes);
  });
  const outcome = await workflow.run({
    toolId: 'batch-compress-png',
    input: batch([png('one.png'), png('two.png'), png('three.png')]),
    options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(calls, 2);
  assert.deepEqual(deliveries, []);
  assert.deepEqual(telemetry, ['start', 'terminal:failed']);
});

test('cancellation stops the active and pending items, cleans up once, and ignores late progress', async () => {
  const controller = new AbortController();
  let calls = 0;
  let cleanups = 0;
  let lateProgress: (() => void) | undefined;
  let signalCompressorEntered: (() => void) | undefined;
  const compressorEntered = new Promise<void>((resolve) => {
    signalCompressorEntered = resolve;
  });
  const { workflow, deliveries, telemetry } = recorder(
    async ({ signal, registerCleanup, reportProgress }) => {
      calls += 1;
      await registerCleanup(async () => {
        cleanups += 1;
      });
      lateProgress = () => reportProgress(1);
      signalCompressorEntered?.();
      return await new Promise<Uint8Array>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
  );
  const snapshots: unknown[] = [];
  const pending = workflow.run(
    {
      toolId: 'batch-compress-png',
      input: batch([png('one.png'), png('two.png')]),
      options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
    },
    {
      signal: controller.signal,
      observe: (snapshot) => snapshots.push(snapshot),
    },
  );
  await compressorEntered;
  controller.abort(new DOMException('cancelled', 'AbortError'));
  const outcome = await pending;
  const beforeLate = snapshots.length;
  lateProgress?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(outcome.status, 'cancelled');
  assert.equal(calls, 1);
  assert.equal(cleanups, 1);
  assert.deepEqual(deliveries, []);
  assert.deepEqual(telemetry, ['start', 'terminal:cancelled']);
  assert.equal(snapshots.length, beforeLate);
});

test('cancellation closes the active acquisition stream and never opens pending items', async () => {
  let streamsOpened = 0;
  let activeCancelled = false;
  const stalled = {
    name: 'one.png',
    format: 'png',
    mimeType: 'image/png',
    size: sample.byteLength,
    stream() {
      streamsOpened += 1;
      return new ReadableStream<Uint8Array>({
        pull() {},
        cancel() {
          activeCancelled = true;
        },
      });
    },
  };
  const pending = { ...stalled, name: 'two.png' };
  const { workflow, telemetry, deliveries } = recorder();
  const controller = new AbortController();
  const outcomePromise = workflow.run(
    {
      toolId: 'batch-compress-png',
      input: { kind: 'batch', items: [stalled, pending] },
      options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
    },
    { signal: controller.signal },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort(new DOMException('cancelled', 'AbortError'));
  const outcome = await outcomePromise;
  assert.equal(outcome.status, 'cancelled');
  assert.equal(streamsOpened, 1);
  assert.equal(activeCancelled, true);
  assert.deepEqual(telemetry, []);
  assert.deepEqual(deliveries, []);
});

test('a size-mismatched stream fails without overstating acquisition progress', async () => {
  const { workflow } = recorder();
  const snapshots: WorkflowSnapshot[] = [];
  const outcome = await workflow.run(
    {
      toolId: 'batch-compress-png',
      input: {
        kind: 'batch',
        items: [
          {
            name: 'changed.png',
            format: 'png',
            mimeType: 'image/png',
            size: Math.floor(sample.byteLength / 2),
            stream: () => new Blob([sample]).stream(),
          },
        ],
      },
      options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
    },
    { observe: (snapshot) => snapshots.push(snapshot) },
  );
  assert.equal(outcome.status, 'failed');
  assert.ok(
    snapshots
      .filter(
        ({ phase, progress }) =>
          phase === 'acquiring' && progress !== undefined,
      )
      .every(({ progress }) => progress! <= 0.25),
  );
});

test('browser controller clears prior delivery resources on replacement and cancellation', async () => {
  let clears = 0;
  const workflow = {
    async run() {
      return {
        status: 'failed' as const,
        runId: 'run-1',
        error: { code: 'processor-failed' as const, message: 'failed' },
        telemetry: {
          start: 'submitted' as const,
          terminal: 'submitted' as const,
        },
      };
    },
  };
  const controller = createBatchRunController(workflow, {
    clear() {
      clears += 1;
    },
  });
  await controller.runFiles(
    [
      {
        name: 'one.png',
        type: 'image/png',
        size: sample.byteLength,
        stream: () => new Blob([sample]).stream(),
      },
    ],
    'high',
  );
  assert.equal(clears, 1);
  controller.cancel();
  assert.equal(clears, 2);
});

test('browser controller lease suppresses stale replacement progress and outcomes', async () => {
  const runs: Array<{
    resolve(outcome: Awaited<ReturnType<ToolWorkflow['run']>>): void;
    observe?: (snapshot: WorkflowSnapshot) => void;
  }> = [];
  const workflow: ToolWorkflow = {
    run(_request, options) {
      return new Promise((resolve) =>
        runs.push({ resolve, observe: options?.observe }),
      );
    },
  };
  const snapshots: string[] = [];
  const outcomes: string[] = [];
  const controller = createBatchRunController(
    workflow,
    { clear() {} },
    {
      observe(snapshot) {
        snapshots.push(snapshot.phase);
      },
      onOutcome(outcome) {
        outcomes.push(outcome.runId);
      },
    },
  );
  const file = {
    name: 'one.png',
    type: 'image/png',
    size: sample.byteLength,
    stream: () => new Blob([sample]).stream(),
  };
  const first = controller.runFiles([file], 'high');
  const second = controller.runFiles([file], 'high');
  runs[0]!.observe?.({ phase: 'processing', progress: 0.5 });
  runs[1]!.observe?.({ phase: 'processing', progress: 0.25 });
  runs[0]!.resolve({
    status: 'cancelled',
    runId: 'stale',
    telemetry: { start: 'submitted', terminal: 'submitted' },
  });
  runs[1]!.resolve({
    status: 'cancelled',
    runId: 'current',
    telemetry: { start: 'submitted', terminal: 'submitted' },
  });
  assert.equal(await first, undefined);
  assert.equal((await second)?.runId, 'current');
  assert.deepEqual(snapshots, ['processing']);
  assert.deepEqual(outcomes, ['current']);
});

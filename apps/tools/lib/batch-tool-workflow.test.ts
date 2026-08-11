import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import {
  BATCH_PNG_LIMITS,
  createBatchToolWorkflow,
  getBatchToolContract,
  type BatchCompressionPort,
} from './batch-tool-workflow.ts';
import type { WorkflowMedia } from './tool-workflow/index.ts';
import { getToolProcessorAvailability } from './tool-processor-registry.ts';

const sample = new Uint8Array(
  readFileSync(new URL('../benchmarks/fixtures/sample.png', import.meta.url)),
);
const sample2 = new Uint8Array(
  readFileSync(new URL('../benchmarks/fixtures/sample-2.png', import.meta.url)),
);

function png(name: string, bytes = sample): WorkflowMedia {
  return { name, format: 'png', mimeType: 'image/png', bytes };
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
  const snapshots: Array<{
    progress?: number;
    item?: { index: number; total: number; name: string; progress?: number };
  }> = [];

  const outcome = await workflow.run(
    {
      toolId: 'batch-compress-png',
      input: {
        kind: 'files',
        media: [png('zeta.png'), png('alpha.PNG', sample2)],
      },
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
  const itemSnapshots = snapshots.filter(({ item }) => item);
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
      input: { kind: 'files', media },
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
    input: { kind: 'files', media: [png('one.png')] },
    options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
  });
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(deliveries, []);
  assert.deepEqual(telemetry, ['start', 'terminal:failed']);
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
    input: {
      kind: 'files',
      media: [png('one.png'), png('two.png'), png('three.png')],
    },
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
  const { workflow, deliveries, telemetry } = recorder(
    async ({ signal, registerCleanup, reportProgress }) => {
      calls += 1;
      await registerCleanup(async () => {
        cleanups += 1;
      });
      lateProgress = () => reportProgress(1);
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
      input: { kind: 'files', media: [png('one.png'), png('two.png')] },
      options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
    },
    {
      signal: controller.signal,
      observe: (snapshot) => snapshots.push(snapshot),
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
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

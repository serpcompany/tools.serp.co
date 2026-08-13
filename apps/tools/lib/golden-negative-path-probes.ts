import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createBatchToolWorkflow } from './batch-tool-workflow.ts';
import {
  createGenericToolWorkflow,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from './generic-tool-workflow.ts';
import type { WorkflowMedia, WorkflowOutcome } from './tool-workflow/index.ts';
import { inspectBmp } from './convert/bmp.ts';

export const GOLDEN_NEGATIVE_PATH_CHECKS = Object.freeze([
  'malformed-input',
  'spoofed-input',
  'wrong-format-output',
  'no-delivery-on-failure',
  'cancellation-lifecycle',
] as const);

type GoldenNegativePathCheck = (typeof GOLDEN_NEGATIVE_PATH_CHECKS)[number];

export type GoldenNegativePathProof = Readonly<{
  journeyId: 'batch-compress-png:multiple-file-upload' | 'bmp-to-png:upload';
  checks: readonly GoldenNegativePathCheck[];
  observed: Readonly<{
    failedRuns: number;
    cancelledRuns: number;
    deliveries: number;
    cleanupCalls: number;
    terminalStatuses: readonly WorkflowOutcome['status'][];
  }>;
}>;

function media(
  name: string,
  format: string,
  mimeType: string,
  bytes: Uint8Array,
) {
  return { name, format, mimeType, bytes } satisfies WorkflowMedia;
}

function batchInput(items: readonly WorkflowMedia[]) {
  return {
    kind: 'batch' as const,
    items: items.map((item) => ({
      name: item.name,
      format: item.format,
      mimeType: item.mimeType,
      size: item.bytes.byteLength,
      stream: () => new Blob([Uint8Array.from(item.bytes)]).stream(),
    })),
  };
}

function assertOutcome(
  outcome: WorkflowOutcome,
  expected: 'failed' | 'cancelled',
  label: string,
) {
  if (outcome.status !== expected) {
    throw new TypeError(
      `${label} was ${outcome.status}, expected ${expected}.`,
    );
  }
}

/** Exercises the public batch workflow with real acquisition and validation. */
export async function proveBatchPngNegativePaths(fixtures: {
  png: Uint8Array;
  spoofedNonPng: Uint8Array;
}): Promise<GoldenNegativePathProof> {
  let deliveries = 0;
  let cleanupCalls = 0;
  let sequence = 0;
  const terminalStatuses: WorkflowOutcome['status'][] = [];
  let compressionMode: 'identity' | 'wrong-format' | 'stall' = 'identity';
  let enteredStall: (() => void) | undefined;
  const stalled = new Promise<void>((resolve) => {
    enteredStall = resolve;
  });
  const workflow = createBatchToolWorkflow({
    async compress({ bytes, signal, registerCleanup }) {
      if (compressionMode === 'wrong-format') {
        return new TextEncoder().encode('not a png');
      }
      if (compressionMode === 'stall') {
        await registerCleanup(async () => {
          cleanupCalls += 1;
        });
        enteredStall?.();
        return new Promise<Uint8Array>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      }
      return Uint8Array.from(bytes);
    },
    async deliver() {
      deliveries += 1;
      return `delivery-${deliveries}`;
    },
    telemetry: {
      async start() {},
      async terminal(_runId, status) {
        terminalStatuses.push(status);
      },
    },
    nextId(kind) {
      sequence += 1;
      return `${kind}-${sequence}`;
    },
  });
  const request = (bytes: Uint8Array) => ({
    toolId: 'batch-compress-png',
    input: batchInput([media('sample.png', 'png', 'image/png', bytes)]),
    options: { compressionLevel: 'high', partialSuccess: 'fail-fast' },
  });

  const malformed = await workflow.run(request(fixtures.png.subarray(0, 12)));
  assertOutcome(malformed, 'failed', 'Malformed batch PNG');
  const spoofed = await workflow.run(request(fixtures.spoofedNonPng));
  assertOutcome(spoofed, 'failed', 'Spoofed batch PNG');
  compressionMode = 'wrong-format';
  const wrongOutput = await workflow.run(request(fixtures.png));
  assertOutcome(wrongOutput, 'failed', 'Wrong-format batch output');

  compressionMode = 'stall';
  const controller = new AbortController();
  const cancellation = workflow.run(request(fixtures.png), {
    signal: controller.signal,
  });
  await stalled;
  controller.abort(new DOMException('Cancelled by proof', 'AbortError'));
  const cancelled = await cancellation;
  assertOutcome(cancelled, 'cancelled', 'Batch cancellation');
  if (deliveries !== 0 || cleanupCalls !== 1) {
    throw new TypeError(
      `Batch negative paths observed ${deliveries} deliveries and ${cleanupCalls} cleanups.`,
    );
  }
  if (
    terminalStatuses.filter((status) => status === 'failed').length !== 1 ||
    terminalStatuses.filter((status) => status === 'cancelled').length !== 1
  ) {
    throw new TypeError('Batch processing terminals were not exact.');
  }
  return Object.freeze({
    journeyId: 'batch-compress-png:multiple-file-upload',
    checks: GOLDEN_NEGATIVE_PATH_CHECKS,
    observed: Object.freeze({
      failedRuns: 3,
      cancelledRuns: 1,
      deliveries,
      cleanupCalls,
      terminalStatuses: Object.freeze([...terminalStatuses]),
    }),
  });
}

/** Exercises the generic BMP processor through the public Tool workflow. */
export async function proveBmpToPngNegativePaths(fixtures: {
  bmp: Uint8Array;
  spoofedNonBmp: Uint8Array;
  wrongFormatOutput: Uint8Array;
}): Promise<GoldenNegativePathProof> {
  let deliveries = 0;
  let cleanupCalls = 0;
  let processed = 0;
  let mode: 'wrong-format' | 'stall' = 'wrong-format';
  let enteredStall: (() => void) | undefined;
  const stalled = new Promise<void>((resolve) => {
    enteredStall = resolve;
  });
  const terminalStatuses: WorkflowOutcome['status'][] = [];
  const adapters: GenericWorkflowAdapters = {
    decideSupport: () => ({ supported: true }),
    async convert({ context }) {
      processed += 1;
      if (mode === 'stall') {
        await context.registerWorker({
          terminate() {
            cleanupCalls += 1;
          },
        } as Worker);
        enteredStall?.();
        return new Promise<readonly Uint8Array[]>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(context.signal.reason),
            { once: true },
          );
        });
      }
      return [fixtures.wrongFormatOutput];
    },
    async compress() {
      throw new TypeError('BMP proof never compresses.');
    },
    verify: (result, context) =>
      result.format === 'bmp'
        ? Promise.resolve(inspectBmp(result.bytes))
        : verifyGenericMediaSemantics(result, { signal: context.signal }),
    async deliver() {
      deliveries += 1;
      return `delivery-${deliveries}`;
    },
    telemetry: {
      async start() {},
      async terminal(_runId, status) {
        terminalStatuses.push(status);
      },
    },
  };
  const workflow = createGenericToolWorkflow(adapters);
  const request = (bytes: Uint8Array) => ({
    toolId: 'bmp-to-png',
    input: {
      kind: 'file' as const,
      media: media('sample.bmp', 'bmp', 'image/bmp', bytes),
    },
  });
  const malformed = await workflow.run(request(fixtures.bmp.subarray(0, 53)));
  assertOutcome(malformed, 'failed', 'Malformed BMP');
  const spoofed = await workflow.run(request(fixtures.spoofedNonBmp));
  assertOutcome(spoofed, 'failed', 'Spoofed BMP');
  const wrongOutput = await workflow.run(request(fixtures.bmp));
  assertOutcome(wrongOutput, 'failed', 'Wrong-format BMP output');

  mode = 'stall';
  const controller = new AbortController();
  const cancellation = workflow.run(request(fixtures.bmp), {
    signal: controller.signal,
  });
  await stalled;
  controller.abort(new DOMException('Cancelled by proof', 'AbortError'));
  const cancelled = await cancellation;
  assertOutcome(cancelled, 'cancelled', 'BMP cancellation');
  if (processed !== 2 || deliveries !== 0 || cleanupCalls !== 1) {
    throw new TypeError(
      `BMP negative paths observed ${processed} processing calls, ${deliveries} deliveries, and ${cleanupCalls} cleanups.`,
    );
  }
  if (
    terminalStatuses.filter((status) => status === 'failed').length !== 1 ||
    terminalStatuses.filter((status) => status === 'cancelled').length !== 1
  ) {
    throw new TypeError('BMP processing terminals were not exact.');
  }
  return Object.freeze({
    journeyId: 'bmp-to-png:upload',
    checks: GOLDEN_NEGATIVE_PATH_CHECKS,
    observed: Object.freeze({
      failedRuns: 3,
      cancelledRuns: 1,
      deliveries,
      cleanupCalls,
      terminalStatuses: Object.freeze([...terminalStatuses]),
    }),
  });
}

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

export async function runGoldenBatchPngNegativeProbe() {
  return proveBatchPngNegativePaths({
    png: fixture('sample.png'),
    spoofedNonPng: fixture('sample.bmp'),
  });
}

export async function runGoldenBmpToPngNegativeProbe() {
  return proveBmpToPngNegativePaths({
    bmp: fixture('sample.bmp'),
    spoofedNonBmp: fixture('sample.png'),
    wrongFormatOutput: fixture('sample.jpg'),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${JSON.stringify({
      batch: await runGoldenBatchPngNegativeProbe(),
      bmp: await runGoldenBmpToPngNegativeProbe(),
    })}\n`,
  );
}

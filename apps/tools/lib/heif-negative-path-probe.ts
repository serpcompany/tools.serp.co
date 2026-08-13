import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createGenericToolWorkflow,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from './generic-tool-workflow.ts';
import { inspectHeifContainer } from './convert/heif-semantics.ts';
import type { WorkflowOutcome } from './tool-workflow/index.ts';

export const HEIF_NEGATIVE_PATH_CHECKS = Object.freeze([
  'malformed-input',
  'spoofed-input',
  'wrong-format-output',
  'no-delivery-on-failure',
  'cancellation-lifecycle',
] as const);

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

export async function proveHeifNegativePaths(
  fixtures: Readonly<{
    heif: Uint8Array;
    spoofedNonHeif: Uint8Array;
    wrongFormatOutput: Uint8Array;
  }>,
) {
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
      throw new TypeError('HEIF proof never compresses.');
    },
    async verify(media, context) {
      if (media.format === 'heif') return inspectHeifContainer(media.bytes);
      return verifyGenericMediaSemantics(media, { signal: context.signal });
    },
    async decodeRaster(media) {
      if (media.format === 'heif') {
        return {
          width: 1,
          height: 1,
          rgba: new Uint8Array([253, 165, 0, 255]),
        };
      }
      throw new TypeError('Wrong-format output cannot be decoded as PNG.');
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
  };
  const workflow = createGenericToolWorkflow(adapters);
  const request = (bytes: Uint8Array) => ({
    toolId: 'heif-to-png',
    input: {
      kind: 'file' as const,
      media: {
        name: 'sample.heif',
        format: 'heif',
        mimeType: 'image/heif',
        bytes,
      },
    },
  });
  assertOutcome(
    await workflow.run(request(fixtures.heif.subarray(0, 12))),
    'failed',
    'Malformed HEIF',
  );
  assertOutcome(
    await workflow.run(request(fixtures.spoofedNonHeif)),
    'failed',
    'Spoofed HEIF',
  );
  assertOutcome(
    await workflow.run(request(fixtures.heif)),
    'failed',
    'Wrong-format HEIF output',
  );

  mode = 'stall';
  const controller = new AbortController();
  const cancellation = workflow.run(request(fixtures.heif), {
    signal: controller.signal,
  });
  await stalled;
  controller.abort(new DOMException('Cancelled by proof', 'AbortError'));
  assertOutcome(await cancellation, 'cancelled', 'HEIF cancellation');
  if (processed !== 2 || deliveries !== 0 || cleanupCalls !== 1) {
    throw new TypeError(
      `HEIF negative paths observed ${processed} processing calls, ${deliveries} deliveries, and ${cleanupCalls} cleanups.`,
    );
  }
  return Object.freeze({
    journeyId: 'heif-to-png:upload',
    checks: HEIF_NEGATIVE_PATH_CHECKS,
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

export function runHeifNegativePathProbe() {
  return proveHeifNegativePaths({
    heif: fixture('sample.heif'),
    spoofedNonHeif: fixture('sample.png'),
    wrongFormatOutput: fixture('sample.jpg'),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await runHeifNegativePathProbe())}\n`);
}

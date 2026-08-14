import {
  createGenericToolWorkflow,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from './generic-tool-workflow.ts';
import { ICO_TO_PNG_CANDIDATE_CONTRACT } from './convert/ico.ts';
import type { WorkflowOutcome } from './tool-workflow/index.ts';
import { ICO_NEGATIVE_PATH_CHECKS } from './ico-negative-path-checks.mjs';

export { ICO_NEGATIVE_PATH_CHECKS } from './ico-negative-path-checks.mjs';

export async function proveIcoNegativePaths(
  fixtures: Readonly<{
    validIco: Uint8Array;
    spoofedNonIco: Uint8Array;
    wrongFormatOutput: Uint8Array;
  }>,
) {
  let deliveries = 0;
  let cleanupCalls = 0;
  let mode: 'wrong-output' | 'stall' = 'wrong-output';
  let enteredStall: (() => void) | undefined;
  const stalled = new Promise<void>((resolve) => {
    enteredStall = resolve;
  });
  const terminalStatuses: WorkflowOutcome['status'][] = [];
  const adapters: GenericWorkflowAdapters = {
    decideSupport: () => ({ supported: true }),
    async convert({ context }) {
      if (mode === 'wrong-output') return [fixtures.wrongFormatOutput];
      await context.registerWorker({
        terminate() {
          cleanupCalls += 1;
        },
      } as Worker);
      enteredStall?.();
      return await new Promise<readonly Uint8Array[]>((_resolve, reject) => {
        context.signal.addEventListener(
          'abort',
          () => reject(context.signal.reason),
          { once: true },
        );
      });
    },
    async compress() {
      throw new TypeError('ICO proof never compresses.');
    },
    verify: (media, context) =>
      verifyGenericMediaSemantics(media, { signal: context.signal }),
    async verifyIcoEquivalence() {
      return { status: 'verified' };
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
  const workflow = createGenericToolWorkflow(adapters, {
    resolveContract: () => ICO_TO_PNG_CANDIDATE_CONTRACT,
  });
  const request = (bytes: Uint8Array) => ({
    toolId: 'ico-to-png',
    input: {
      kind: 'file' as const,
      media: {
        name: 'sample.ico',
        format: 'ico',
        mimeType: 'image/x-icon',
        bytes,
      },
    },
  });
  const malformed = await workflow.run(
    request(fixtures.validIco.subarray(0, 5)),
  );
  const spoofed = await workflow.run(request(fixtures.spoofedNonIco));
  const wrongOutput = await workflow.run(request(fixtures.validIco));
  for (const [label, outcome] of [
    ['malformed', malformed],
    ['spoofed', spoofed],
    ['wrong output', wrongOutput],
  ] as const) {
    if (outcome.status !== 'failed') {
      throw new TypeError(`ICO ${label} outcome was ${outcome.status}.`);
    }
  }

  mode = 'stall';
  const controller = new AbortController();
  const cancellation = workflow.run(request(fixtures.validIco), {
    signal: controller.signal,
  });
  await stalled;
  controller.abort(new DOMException('Cancelled by ICO proof', 'AbortError'));
  const cancelled = await cancellation;
  if (cancelled.status !== 'cancelled') {
    throw new TypeError(`ICO cancellation was ${cancelled.status}.`);
  }
  if (deliveries !== 0 || cleanupCalls !== 1) {
    throw new TypeError(
      `ICO proof observed ${deliveries} deliveries and ${cleanupCalls} cleanups.`,
    );
  }
  return Object.freeze({
    journeyId: 'ico-to-png:upload' as const,
    checks: ICO_NEGATIVE_PATH_CHECKS,
    observed: Object.freeze({
      failedRuns: 3,
      cancelledRuns: 1,
      deliveries,
      cleanupCalls,
      terminalStatuses: Object.freeze([...terminalStatuses]),
    }),
  });
}

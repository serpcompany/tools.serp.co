import {
  createGenericToolWorkflow,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from './generic-tool-workflow.ts';
import type { WorkflowOutcome } from './tool-workflow/index.ts';
import type { TiffToolId } from './convert/tiff.ts';

export const TIFF_NEGATIVE_PATH_CHECKS = Object.freeze([
  'malformed-input',
  'spoofed-input',
  'wrong-format-output',
  'no-delivery-on-failure',
  'cancellation-lifecycle',
] as const);

export async function proveTiffNegativePaths(
  toolId: TiffToolId,
  fixtures: Readonly<{
    validTiff: Uint8Array;
    spoofedNonTiff: Uint8Array;
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
      throw new TypeError('TIFF proof never compresses.');
    },
    verify: (media, context) =>
      verifyGenericMediaSemantics(media, { signal: context.signal }),
    async verifyTiffEquivalence() {
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
  const workflow = createGenericToolWorkflow(adapters);
  const format = toolId === 'tif-to-png' ? 'tif' : 'tiff';
  const request = (bytes: Uint8Array) => ({
    toolId,
    input: {
      kind: 'file' as const,
      media: {
        name: `sample.${format}`,
        format,
        mimeType: 'image/tiff',
        bytes,
      },
    },
  });
  const malformed = await workflow.run(
    request(fixtures.validTiff.subarray(0, 7)),
  );
  const spoofed = await workflow.run(request(fixtures.spoofedNonTiff));
  const wrongOutput = await workflow.run(request(fixtures.validTiff));
  for (const [label, outcome] of [
    ['malformed', malformed],
    ['spoofed', spoofed],
    ['wrong output', wrongOutput],
  ] as const) {
    if (outcome.status !== 'failed') {
      throw new TypeError(`${toolId} ${label} outcome was ${outcome.status}.`);
    }
  }

  mode = 'stall';
  const controller = new AbortController();
  const cancellation = workflow.run(request(fixtures.validTiff), {
    signal: controller.signal,
  });
  await stalled;
  controller.abort(new DOMException('Cancelled by TIFF proof', 'AbortError'));
  const cancelled = await cancellation;
  if (cancelled.status !== 'cancelled') {
    throw new TypeError(`${toolId} cancellation was ${cancelled.status}.`);
  }
  if (deliveries !== 0 || cleanupCalls !== 1) {
    throw new TypeError(
      `${toolId} observed ${deliveries} deliveries and ${cleanupCalls} cleanups.`,
    );
  }
  return Object.freeze({
    journeyId: `${toolId}:upload` as const,
    checks: TIFF_NEGATIVE_PATH_CHECKS,
    observed: Object.freeze({
      failedRuns: 3,
      cancelledRuns: 1,
      deliveries,
      cleanupCalls,
      terminalStatuses: Object.freeze([...terminalStatuses]),
    }),
  });
}

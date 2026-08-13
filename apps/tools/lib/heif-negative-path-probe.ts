import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createGenericToolWorkflow,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from './generic-tool-workflow.ts';
import { mimeTypeForGenericFormat } from './generic-tool-contract.ts';
import {
  HEIF_CONVERSION_TOOL_IDS,
  type HeifConversionToolId,
} from './convert/heif-contract.ts';
import { inspectHeifContainer } from './convert/heif-semantics.ts';
import type { WorkflowOutcome } from './tool-workflow/index.ts';

export const HEIF_NEGATIVE_PATH_CHECKS = Object.freeze([
  'malformed-input',
  'spoofed-input',
  'wrong-format-output',
  'no-delivery-on-failure',
  'cancellation-lifecycle',
] as const);

type OutputFormat = 'jpg' | 'pdf' | 'png' | 'webp';
type CancellationPhase = 'encode';

const OUTPUT_FORMAT_BY_TOOL = Object.freeze({
  'heif-to-jpg': 'jpg',
  'heif-to-pdf': 'pdf',
  'heif-to-png': 'png',
  'heif-to-webp': 'webp',
} satisfies Record<HeifConversionToolId, OutputFormat>);

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

async function proveJourney(
  toolId: HeifConversionToolId,
  fixtures: Readonly<{
    heif: Uint8Array;
    spoofedNonHeif: Uint8Array;
    outputs: Readonly<Record<OutputFormat, Uint8Array>>;
  }>,
) {
  const outputFormat = OUTPUT_FORMAT_BY_TOOL[toolId];
  const wrongFormat = outputFormat === 'png' ? 'jpg' : 'png';
  let deliveries = 0;
  let cleanupCalls = 0;
  let processed = 0;
  let mode: 'wrong-format' | CancellationPhase = 'wrong-format';
  let enteredPhase: (() => void) | undefined;
  const terminalStatuses: WorkflowOutcome['status'][] = [];

  const stall = (signal: AbortSignal) => {
    enteredPhase?.();
    return new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
  };
  const adapters: GenericWorkflowAdapters = {
    decideSupport: () => ({ supported: true }),
    async convert({ context }) {
      processed += 1;
      if (mode === 'encode') {
        await context.registerWorker({
          terminate() {
            cleanupCalls += 1;
          },
        } as Worker);
        return stall(context.signal);
      }
      return [
        mode === 'wrong-format'
          ? fixtures.outputs[wrongFormat]
          : fixtures.outputs[outputFormat],
      ];
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
      throw new TypeError('Wrong-format output cannot satisfy the contract.');
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
  const workflow = createGenericToolWorkflow(adapters, (requestedToolId) => {
    if (requestedToolId !== toolId) {
      return {
        state: 'unsupported',
        toolId: requestedToolId,
        reason: 'Outside the exact HEIF readiness proof',
      };
    }
    return {
      state: 'supported',
      toolId,
      adapterId: 'generic-conversion',
      operation: 'convert',
      input: { format: 'heif', mimeType: 'image/heif' },
      output: {
        format: outputFormat,
        mimeType: mimeTypeForGenericFormat(outputFormat)!,
      },
    };
  });
  const request = (bytes: Uint8Array) => ({
    toolId,
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
    `${toolId} malformed HEIF`,
  );
  assertOutcome(
    await workflow.run(request(fixtures.spoofedNonHeif)),
    'failed',
    `${toolId} spoofed HEIF`,
  );
  assertOutcome(
    await workflow.run(request(fixtures.heif)),
    'failed',
    `${toolId} wrong-format output`,
  );

  for (const phase of ['encode'] as const) {
    mode = phase;
    const entered = new Promise<void>((resolve) => {
      enteredPhase = resolve;
    });
    const controller = new AbortController();
    const cancellation = workflow.run(request(fixtures.heif), {
      signal: controller.signal,
    });
    await Promise.race([
      entered,
      cancellation.then((outcome) => {
        throw new TypeError(
          `${toolId} finished ${JSON.stringify(outcome)} before entering ${phase}`,
        );
      }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new TypeError(`${toolId} never entered ${phase}`)),
          250,
        ),
      ),
    ]);
    controller.abort(new DOMException('Cancelled by proof', 'AbortError'));
    assertOutcome(await cancellation, 'cancelled', `${toolId} ${phase}`);
  }
  if (processed !== 2 || deliveries !== 0 || cleanupCalls !== 1) {
    throw new TypeError(
      `${toolId} observed ${processed} processing calls, ${deliveries} deliveries, and ${cleanupCalls} worker cleanups.`,
    );
  }
  return Object.freeze({
    journeyId: `${toolId}:upload`,
    checks: HEIF_NEGATIVE_PATH_CHECKS,
    observed: Object.freeze({
      failedRuns: 3,
      cancelledRuns: 1,
      cancellationPhases: Object.freeze(['encode'] as const),
      deliveries,
      cleanupCalls,
      terminalStatuses: Object.freeze([...terminalStatuses]),
    }),
  });
}

export async function proveHeifNegativePaths(
  fixtures: Readonly<{
    heif: Uint8Array;
    spoofedNonHeif: Uint8Array;
    outputs: Readonly<Record<OutputFormat, Uint8Array>>;
  }>,
) {
  const journeys = [];
  for (const toolId of HEIF_CONVERSION_TOOL_IDS) {
    journeys.push(await proveJourney(toolId, fixtures));
  }
  return Object.freeze({ journeys: Object.freeze(journeys) });
}

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

export function runHeifNegativePathProbe() {
  return proveHeifNegativePaths({
    heif: fixture('sample.heif'),
    spoofedNonHeif: fixture('sample.png'),
    outputs: {
      jpg: fixture('sample.jpg'),
      pdf: fixture('sample.pdf'),
      png: fixture('sample.png'),
      webp: fixture('sample.webp'),
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await runHeifNegativePathProbe())}\n`);
}

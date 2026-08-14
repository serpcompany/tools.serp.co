import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createGenericToolWorkflow,
  type GenericWorkflowAdapters,
  verifyGenericMediaSemantics,
} from './generic-tool-workflow.ts';

export const SVG_NEGATIVE_PATH_CHECKS = Object.freeze([
  'malformed-input',
  'spoofed-input',
  'wrong-format-output',
  'no-delivery-on-failure',
  'cancellation-lifecycle',
] as const);

type SvgNegativePathCheck = (typeof SVG_NEGATIVE_PATH_CHECKS)[number];

export type SvgNegativePathProof = Readonly<{
  journeyId: 'compress-svg:upload';
  checks: readonly SvgNegativePathCheck[];
  observed: Readonly<{
    deliveries: number;
    terminatedWorkers: number;
    terminalStatuses: readonly string[];
  }>;
}>;

const encoder = new TextEncoder();

function request(bytes: Uint8Array) {
  return {
    toolId: 'compress-svg',
    input: {
      kind: 'file' as const,
      media: {
        name: 'sample.svg',
        format: 'svg',
        mimeType: 'image/svg+xml',
        bytes,
      },
    },
  };
}

/** Exercises the exact public SVG workflow through validation and cleanup. */
export async function proveSvgCompressionNegativePaths(fixtures: {
  safeSvg: Uint8Array;
  spoofedNonSvg: Uint8Array;
}): Promise<SvgNegativePathProof> {
  let mode: 'active-output' | 'changed-output' | 'larger-output' | 'stall' =
    'active-output';
  let deliveries = 0;
  let terminatedWorkers = 0;
  let enteredStall: (() => void) | undefined;
  const stalled = new Promise<void>((resolve) => {
    enteredStall = resolve;
  });
  const terminalStatuses: string[] = [];
  const adapters: GenericWorkflowAdapters = {
    decideSupport: () => ({ supported: true }),
    async convert() {
      throw new TypeError('SVG compression proof never converts.');
    },
    async compress({ context }) {
      if (mode === 'active-output') {
        return encoder.encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        );
      }
      if (mode === 'changed-output') {
        return encoder.encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="red"/></svg>',
        );
      }
      if (mode === 'larger-output') {
        return encoder.encode(
          `${new TextDecoder().decode(fixtures.safeSvg)}<!--${'x'.repeat(1_024)}-->`,
        );
      }
      await context.registerWorker({
        terminate() {
          terminatedWorkers += 1;
        },
      } as Worker);
      enteredStall?.();
      return new Promise<Uint8Array>((_resolve, reject) => {
        context.signal.addEventListener(
          'abort',
          () => reject(context.signal.reason),
          { once: true },
        );
      });
    },
    verify: (media, context) =>
      verifyGenericMediaSemantics(media, { signal: context.signal }),
    async verifySvgEquivalence(input, output) {
      return input.bytes.byteLength === output.bytes.byteLength &&
        input.bytes.every((value, index) => output.bytes[index] === value)
        ? { status: 'verified' }
        : { status: 'rejected', message: 'SVG visible semantics changed' };
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
  const malformed = await workflow.run(
    request(
      encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'),
    ),
  );
  const spoofed = await workflow.run(request(fixtures.spoofedNonSvg));
  const activeOutput = await workflow.run(request(fixtures.safeSvg));
  mode = 'changed-output';
  const changedOutput = await workflow.run(request(fixtures.safeSvg));
  mode = 'larger-output';
  const largerOutput = await workflow.run(request(fixtures.safeSvg));
  for (const [label, outcome] of [
    ['malformed', malformed],
    ['spoofed', spoofed],
    ['active output', activeOutput],
    ['visibly changed output', changedOutput],
    ['larger output', largerOutput],
  ] as const) {
    if (outcome.status !== 'failed') {
      throw new TypeError(`${label} SVG proof was ${outcome.status}.`);
    }
  }

  mode = 'stall';
  const controller = new AbortController();
  const pending = workflow.run(request(fixtures.safeSvg), {
    signal: controller.signal,
  });
  await stalled;
  controller.abort(new DOMException('Cancelled by proof', 'AbortError'));
  const cancelled = await pending;
  if (cancelled.status !== 'cancelled') {
    throw new TypeError(`SVG cancellation proof was ${cancelled.status}.`);
  }
  if (deliveries !== 0 || terminatedWorkers !== 1) {
    throw new TypeError(
      `SVG proof observed ${deliveries} deliveries and ${terminatedWorkers} Worker terminations.`,
    );
  }
  return Object.freeze({
    journeyId: 'compress-svg:upload',
    checks: SVG_NEGATIVE_PATH_CHECKS,
    observed: Object.freeze({
      deliveries,
      terminatedWorkers,
      terminalStatuses: Object.freeze([...terminalStatuses]),
    }),
  });
}

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

export async function runSvgCompressionNegativePathProbe() {
  return proveSvgCompressionNegativePaths({
    safeSvg: fixture('svg-compression-complex.svg'),
    spoofedNonSvg: fixture('sample.png'),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${JSON.stringify(await runSvgCompressionNegativePathProbe())}\n`,
  );
}

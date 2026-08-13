import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createGenericToolWorkflow,
  type GenericWorkflowAdapters,
} from './generic-tool-workflow.ts';
import type { ToolVerificationCheck } from './tool-verification-evidence.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

const PNG = fixture('sample.png');
const JPEG = fixture('sample.jpg');
const WEBP = fixture('sample.webp');

function request(bytes: Uint8Array) {
  return {
    toolId: 'png-to-webp',
    input: {
      kind: 'file' as const,
      media: {
        name: 'sample.png',
        format: 'png',
        mimeType: 'image/png',
        bytes,
      },
    },
  };
}

export async function runGoldenPngWorkflowProbe() {
  let deliveries = 0;
  let terminals = 0;
  let terminatedWorkers = 0;
  const adapters = (
    convert: GenericWorkflowAdapters['convert'],
  ): GenericWorkflowAdapters => ({
    decideSupport: () => ({ supported: true }),
    convert,
    async compress() {
      return WEBP;
    },
    async verify() {
      return { status: 'unavailable', message: 'not needed for PNG/WebP' };
    },
    async deliver() {
      deliveries += 1;
      return `delivery-${deliveries}`;
    },
    telemetry: {
      async start() {},
      async terminal() {
        terminals += 1;
      },
    },
  });

  const normal = createGenericToolWorkflow(
    adapters(async () => Object.freeze([WEBP])),
  );
  const malformed = await normal.run(request(PNG.slice(0, 20)));
  const spoofed = await normal.run(request(JPEG));

  const lying = createGenericToolWorkflow(
    adapters(async () => Object.freeze([PNG])),
  );
  const wrongFormat = await lying.run(request(PNG));

  const controller = new AbortController();
  const cancellable = createGenericToolWorkflow(
    adapters(async ({ context }) => {
      await context.registerWorker({
        terminate() {
          terminatedWorkers += 1;
        },
      } as Worker);
      setTimeout(() => controller.abort('golden pilot cancellation'), 0);
      return new Promise<readonly Uint8Array[]>((_resolve, reject) => {
        const rejectAbort = () =>
          reject(new DOMException('The operation was aborted', 'AbortError'));
        if (context.signal.aborted) rejectAbort();
        else
          context.signal.addEventListener('abort', rejectAbort, { once: true });
      });
    }),
  );
  const cancellation = await cancellable.run(request(PNG), {
    signal: controller.signal,
  });

  const checks: readonly ToolVerificationCheck[] = Object.freeze([
    'malformed-input',
    'spoofed-input',
    'wrong-format-output',
    'no-delivery-on-failure',
    'cancellation-lifecycle',
  ]);
  return Object.freeze({
    journeyId: 'png-to-webp:upload',
    checks,
    observed: Object.freeze({
      malformedOutcome: malformed.status,
      spoofedOutcome: spoofed.status,
      wrongFormatOutcome: wrongFormat.status,
      cancellationOutcome: cancellation.status,
      deliveries,
      terminals,
      terminatedWorkers,
    }),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${JSON.stringify(await runGoldenPngWorkflowProbe())}\n`,
  );
}

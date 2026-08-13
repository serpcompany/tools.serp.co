import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createMediaWorkflow } from './media-workflow/index.ts';
import type { MediaEndpointPort } from './media-workflow/media-endpoint.ts';
import { verifyDownloaderMediaOutput } from './media-workflow/processors.ts';
import {
  createSpecializedToolWorkflow,
  verifyPdfToolOutput,
} from './specialized-tool-workflow.ts';
import {
  createTableToolWorkflow,
  verifyTableToolOutput,
} from './table-tool-processors.ts';
import type {
  ToolWorkflow,
  WorkflowMedia,
  WorkflowOutcome,
} from './tool-workflow/index.ts';
import type { ToolVerificationCheck } from './tool-verification-evidence.ts';

const encoder = new TextEncoder();
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

type Observation = Readonly<{
  status: WorkflowOutcome['status'];
  errorCode: string | null;
  deliveries: number;
  terminal: WorkflowOutcome['status'] | 'cancelled' | null;
}>;

function ids() {
  let sequence = 0;
  return (kind: 'run' | 'delivery') => `${kind}-${++sequence}`;
}

function recorder(
  create: (ports: {
    deliver(media: WorkflowMedia): Promise<string>;
    telemetry: {
      start(): Promise<void>;
      terminal(
        runId: string,
        status: WorkflowOutcome['status'] | 'cancelled',
      ): Promise<void>;
    };
    nextId: ReturnType<typeof ids>;
  }) => ToolWorkflow,
) {
  const deliveries: WorkflowMedia[] = [];
  const terminals: Array<WorkflowOutcome['status'] | 'cancelled'> = [];
  const workflow = create({
    async deliver(media) {
      deliveries.push(media);
      return `delivery-${deliveries.length}`;
    },
    telemetry: {
      async start() {},
      async terminal(_runId, status) {
        terminals.push(status);
      },
    },
    nextId: ids(),
  });
  const observe = (outcome: WorkflowOutcome): Observation =>
    Object.freeze({
      status: outcome.status,
      errorCode: outcome.status === 'failed' ? outcome.error.code : null,
      deliveries: deliveries.length,
      terminal: terminals.at(-1) ?? null,
    });
  return { workflow, deliveries, observe };
}

function fileRequest(
  toolId: string,
  name: string,
  format: string,
  mimeType: string,
  bytes: Uint8Array,
) {
  return {
    toolId,
    input: {
      kind: 'file' as const,
      media: { name, format, mimeType, bytes },
    },
  };
}

async function cancellation(
  workflow: ToolWorkflow,
  request: Parameters<ToolWorkflow['run']>[0],
) {
  const controller = new AbortController();
  return workflow.run(request, {
    signal: controller.signal,
    observe(snapshot) {
      if (snapshot.phase === 'processing')
        controller.abort('golden cancellation');
    },
  });
}

function exactChecks(): readonly ToolVerificationCheck[] {
  return Object.freeze([
    'malformed-input',
    'spoofed-input',
    'wrong-format-output',
    'no-delivery-on-failure',
    'cancellation-lifecycle',
  ]);
}

function finishProbe(
  journeyId: string,
  observed: Readonly<{
    malformed: Observation;
    spoofed: Observation;
    cancelled: Observation;
    wrongOutputRejected: boolean;
    totalDeliveries: number;
  }>,
) {
  if (
    observed.malformed.status !== 'failed' ||
    observed.malformed.errorCode !== 'invalid-request' ||
    observed.spoofed.status !== 'failed' ||
    observed.spoofed.errorCode !== 'invalid-request' ||
    observed.cancelled.status !== 'cancelled' ||
    observed.cancelled.terminal !== 'cancelled' ||
    !observed.wrongOutputRejected ||
    observed.malformed.deliveries !== 0 ||
    observed.spoofed.deliveries !== 0 ||
    observed.cancelled.deliveries !== 0 ||
    observed.totalDeliveries !== 0
  ) {
    throw new Error(`${journeyId} negative-path proof did not fail closed.`);
  }
  return Object.freeze({
    journeyId,
    checks: exactChecks(),
    observed: Object.freeze(observed),
  });
}

export async function runGoldenCsvNegativeProbe() {
  const run = recorder((ports) => createTableToolWorkflow(ports));
  const malformed = await run.workflow.run(
    fileRequest(
      'csv-to-json',
      'malformed.csv',
      'csv',
      'text/csv',
      encoder.encode('name,note\r\nAda\r\n'),
    ),
  );
  const malformedObservation = run.observe(malformed);
  const spoofed = await run.workflow.run(
    fileRequest(
      'csv-to-json',
      'spoofed.csv',
      'csv',
      'text/csv',
      fixture('sample.pdf'),
    ),
  );
  const spoofedObservation = run.observe(spoofed);
  const cancelled = await cancellation(
    run.workflow,
    fileRequest(
      'csv-to-json',
      'sample.csv',
      'csv',
      'text/csv',
      encoder.encode('name,count\r\nAda,1\r\n'),
    ),
  );
  const cancelledObservation = run.observe(cancelled);
  const wrongOutput = await verifyTableToolOutput('csv-to-json', {
    name: 'wrong.json',
    format: 'json',
    mimeType: 'application/json',
    bytes: fixture('sample.pdf'),
  });
  return finishProbe('csv-to-json:upload', {
    malformed: malformedObservation,
    spoofed: spoofedObservation,
    cancelled: cancelledObservation,
    wrongOutputRejected: wrongOutput.status === 'rejected',
    totalDeliveries: run.deliveries.length,
  });
}

export async function runGoldenPdfReaderNegativeProbe() {
  const run = recorder((ports) => createSpecializedToolWorkflow(ports));
  const malformed = await run.workflow.run(
    fileRequest(
      'pdf-reader',
      'malformed.pdf',
      'pdf',
      'application/pdf',
      encoder.encode('%PDF fake'),
    ),
  );
  const malformedObservation = run.observe(malformed);
  const spoofed = await run.workflow.run(
    fileRequest(
      'pdf-reader',
      'spoofed.pdf',
      'pdf',
      'application/pdf',
      encoder.encode('name,count\nAda,1\n'),
    ),
  );
  const spoofedObservation = run.observe(spoofed);
  const cancelled = await cancellation(
    run.workflow,
    fileRequest(
      'pdf-reader',
      'sample.pdf',
      'pdf',
      'application/pdf',
      fixture('sample.pdf'),
    ),
  );
  const cancelledObservation = run.observe(cancelled);
  const wrongOutput = await verifyPdfToolOutput(
    encoder.encode('name,count\nAda,1\n'),
  );
  return finishProbe('pdf-reader:upload', {
    malformed: malformedObservation,
    spoofed: spoofedObservation,
    cancelled: cancelledObservation,
    wrongOutputRejected: wrongOutput.status === 'rejected',
    totalDeliveries: run.deliveries.length,
  });
}

function mediaEndpoint(
  fixtures: Record<string, WorkflowMedia>,
): MediaEndpointPort {
  return {
    async open(request, signal) {
      signal.throwIfAborted();
      const media = fixtures[request.url];
      if (!media) throw new Error('Owned media fixture is unavailable');
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(media.bytes);
            controller.close();
          },
        }),
        contentLength: media.bytes.byteLength,
        extension: media.format,
        fileName: media.name,
        mimeType: media.mimeType,
      };
    },
  };
}

export async function runGoldenVideoDownloaderNegativeProbe() {
  const urls = {
    malformed: 'https://fixture.invalid/malformed.mp4',
    spoofed: 'https://fixture.invalid/spoofed.mp4',
    valid: 'https://fixture.invalid/sample.mp4',
  } as const;
  const run = recorder((ports) =>
    createMediaWorkflow({
      ...ports,
      clock: { now: () => 0 },
      endpoint: mediaEndpoint({
        [urls.malformed]: {
          name: 'malformed.mp4',
          format: 'mp4',
          mimeType: 'video/mp4',
          bytes: new Uint8Array([0, 1, 2, 3]),
        },
        [urls.spoofed]: {
          name: 'spoofed.mp4',
          format: 'mp4',
          mimeType: 'video/mp4',
          bytes: fixture('sample.mp3'),
        },
        [urls.valid]: {
          name: 'sample.mp4',
          format: 'mp4',
          mimeType: 'video/mp4',
          bytes: fixture('sample.mp4'),
        },
      }),
    }),
  );
  const request = (url: string) => ({
    toolId: 'video-downloader',
    input: { kind: 'url' as const, url },
  });
  const malformed = await run.workflow.run(request(urls.malformed));
  const malformedObservation = run.observe(malformed);
  const spoofed = await run.workflow.run(request(urls.spoofed));
  const spoofedObservation = run.observe(spoofed);
  const cancelled = await cancellation(run.workflow, request(urls.valid));
  const cancelledObservation = run.observe(cancelled);
  const wrongOutput = await verifyDownloaderMediaOutput({
    name: 'wrong.mp4',
    format: 'mp4',
    mimeType: 'video/mp4',
    bytes: fixture('sample.mp3'),
  });
  return finishProbe('video-downloader:direct-url', {
    malformed: malformedObservation,
    spoofed: spoofedObservation,
    cancelled: cancelledObservation,
    wrongOutputRejected: wrongOutput.status === 'rejected',
    totalDeliveries: run.deliveries.length,
  });
}

async function runGoldenTranscriptionNegativeProbe(
  journeyId: 'audio-to-text:upload' | 'audio-to-transcript:direct-url',
) {
  let mode: 'empty' | 'stall' = 'empty';
  const urls = {
    malformed: 'https://fixture.invalid/malformed.mp3',
    spoofed: 'https://fixture.invalid/spoofed.mp3',
    valid: 'https://fixture.invalid/speech.mp3',
  } as const;
  const run = recorder((ports) =>
    createMediaWorkflow({
      ...ports,
      clock: { now: () => 0 },
      endpoint: mediaEndpoint({
        [urls.malformed]: {
          name: 'malformed.mp3',
          format: 'mp3',
          mimeType: 'audio/mpeg',
          bytes: new Uint8Array([0, 1, 2, 3]),
        },
        [urls.spoofed]: {
          name: 'spoofed.mp3',
          format: 'mp3',
          mimeType: 'audio/mpeg',
          bytes: fixture('sample.mp4'),
        },
        [urls.valid]: {
          name: 'speech.mp3',
          format: 'mp3',
          mimeType: 'audio/mpeg',
          bytes: fixture('transcription-speech.mp3'),
        },
      }),
      transcription: {
        async transcribe(_media, context) {
          if (mode === 'empty') return '';
          context.signal.throwIfAborted();
          return new Promise<string>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => reject(context.signal.reason),
              { once: true },
            );
          });
        },
      },
    }),
  );
  const upload = journeyId === 'audio-to-text:upload';
  const request = (kind: keyof typeof urls) =>
    upload
      ? fileRequest(
          'audio-to-text',
          `${kind}.mp3`,
          'mp3',
          'audio/mpeg',
          kind === 'malformed'
            ? new Uint8Array([0, 1, 2, 3])
            : kind === 'spoofed'
              ? fixture('sample.mp4')
              : fixture('transcription-speech.mp3'),
        )
      : {
          toolId: 'audio-to-transcript',
          input: { kind: 'url' as const, url: urls[kind] },
        };
  const malformed = await run.workflow.run(request('malformed'));
  const spoofed = await run.workflow.run(request('spoofed'));
  const wrongOutput = await run.workflow.run(request('valid'));
  mode = 'stall';
  const cancelled = await cancellation(run.workflow, request('valid'));
  if (
    malformed.status !== 'failed' ||
    spoofed.status !== 'failed' ||
    wrongOutput.status !== 'failed' ||
    cancelled.status !== 'cancelled' ||
    run.deliveries.length !== 0
  ) {
    throw new Error(`${journeyId} transcription probe did not fail closed.`);
  }
  return Object.freeze({
    journeyId,
    checks: Object.freeze([
      'malformed-input',
      'spoofed-input',
      'wrong-format-output',
      'no-delivery-on-failure',
      'cancellation-lifecycle',
    ] as const),
    observed: Object.freeze({
      failedRuns: 3,
      cancelledRuns: 1,
      deliveries: run.deliveries.length,
    }),
  });
}

export function runGoldenTranscriptionUploadNegativeProbe() {
  return runGoldenTranscriptionNegativeProbe('audio-to-text:upload');
}

export function runGoldenTranscriptionDirectUrlNegativeProbe() {
  return runGoldenTranscriptionNegativeProbe('audio-to-transcript:direct-url');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${JSON.stringify({
      csv: await runGoldenCsvNegativeProbe(),
      pdf: await runGoldenPdfReaderNegativeProbe(),
      video: await runGoldenVideoDownloaderNegativeProbe(),
      audioUpload: await runGoldenTranscriptionUploadNegativeProbe(),
      audioDirect: await runGoldenTranscriptionDirectUrlNegativeProbe(),
    })}\n`,
  );
}

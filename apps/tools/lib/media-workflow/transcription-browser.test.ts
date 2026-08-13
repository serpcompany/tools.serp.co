import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createMediaWorkflow } from './index.ts';
import { createInMemoryMediaEndpoint } from './testing.ts';
import { createBrowserTranscriptionPort } from './transcription-browser.ts';

class ControlledWorker extends EventTarget {
  terminated = 0;
  posted = 0;

  postMessage(): void {
    this.posted += 1;
  }

  terminate(): void {
    this.terminated += 1;
  }
}

function transcriptionContext(signal = new AbortController().signal) {
  const cleanups: Array<() => Promise<void>> = [];
  return {
    cleanups,
    context: {
      signal,
      reportProgress() {},
      async registerCleanup(cleanup: () => Promise<void>) {
        cleanups.push(cleanup);
      },
      async openResource() {},
    },
  };
}

const media = {
  name: 'speech.mp3',
  format: 'mp3',
  mimeType: 'audio/mpeg',
  bytes: new Uint8Array([1]),
};

function progressHeartbeat(worker: ControlledWorker) {
  const timer = setInterval(() => {
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'progress', progress: 50 },
      }),
    );
  }, 1);
  return () => clearInterval(timer);
}

function deadlinePort(worker: ControlledWorker) {
  return createBrowserTranscriptionPort({
    createWorker: () => worker as unknown as Worker,
    extractAudio: async () => new ArrayBuffer(4),
    cleanupExtraction: async () => {},
    silenceTimeoutMs: 5,
    executionTimeoutMs: 15,
  });
}

const sampleMp3 = new Uint8Array(
  readFileSync(
    new URL('../../benchmarks/fixtures/sample.mp3', import.meta.url),
  ),
);

test('transcription extraction silence terminates the shared FFmpeg engine', async () => {
  let cleanupCalls = 0;
  const port = createBrowserTranscriptionPort({
    extractAudio: async () => await new Promise<never>(() => {}),
    cleanupExtraction: async () => {
      cleanupCalls += 1;
    },
    silenceTimeoutMs: 5,
  });
  const { context } = transcriptionContext();

  await assert.rejects(
    port.transcribe(media, context),
    /Transcription extraction stopped responding/,
  );
  assert.equal(cleanupCalls, 1);
});

test('a silent transcription worker terminates once and suppresses late outcomes', async () => {
  const worker = new ControlledWorker();
  const port = createBrowserTranscriptionPort({
    createWorker: () => worker as unknown as Worker,
    extractAudio: async () => new ArrayBuffer(4),
    cleanupExtraction: async () => {},
    silenceTimeoutMs: 5,
  });
  const { context, cleanups } = transcriptionContext();

  const pending = port.transcribe(media, context);
  await assert.rejects(pending, /Transcription worker stopped responding/);
  assert.equal(worker.terminated, 1);

  worker.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'result', text: 'late transcript' },
    }),
  );
  for (const cleanup of cleanups) await cleanup();
  assert.equal(worker.terminated, 1);
});

test('worker progress cannot keep transcription non-terminal beyond its execution deadline', async () => {
  const worker = new ControlledWorker();
  const controller = new AbortController();
  const port = deadlinePort(worker);
  const { context } = transcriptionContext(controller.signal);
  const pending = port.transcribe(media, context);
  const stopProgress = progressHeartbeat(worker);

  await assert.rejects(pending, /Transcription exceeded the 1 second/);
  stopProgress();
  assert.equal(worker.terminated, 1);
});

test('extraction progress cannot keep transcription non-terminal beyond its execution deadline', async () => {
  let extractionProgress:
    | ((progress: { ratio: number; time: number }) => void)
    | undefined;
  let cleanupCalls = 0;
  let workersCreated = 0;
  const port = createBrowserTranscriptionPort({
    createWorker() {
      workersCreated += 1;
      return new ControlledWorker() as unknown as Worker;
    },
    extractAudio: async (_bytes, _format, options) => {
      extractionProgress = options?.onProgress;
      return await new Promise<never>(() => {});
    },
    cleanupExtraction: async () => {
      cleanupCalls += 1;
    },
    silenceTimeoutMs: 5,
    executionTimeoutMs: 15,
  });
  const progress = setInterval(
    () => extractionProgress?.({ ratio: 0.5, time: 0 }),
    1,
  );

  await assert.rejects(
    port.transcribe(media, transcriptionContext().context),
    /Transcription exceeded the 1 second/,
  );
  clearInterval(progress);

  assert.equal(cleanupCalls, 1);
  assert.equal(workersCreated, 0);
});

test('execution deadline becomes one failed workflow terminal and releases resources', async () => {
  const worker = new ControlledWorker();
  const port = deadlinePort(worker);
  const terminal: string[] = [];
  const phases: string[] = [];
  let releases = 0;
  let deliveries = 0;
  const workflow = createMediaWorkflow({
    endpoint: createInMemoryMediaEndpoint({}),
    transcription: port,
    async deliver() {
      deliveries += 1;
      return 'unexpected-delivery';
    },
    telemetry: {
      async start() {},
      async terminal(_runId, status) {
        terminal.push(status);
      },
    },
    clock: { now: () => 0 },
    nextId: () => 'deadline-run',
    runtime: {
      async open() {
        return {
          async release() {
            releases += 1;
          },
        };
      },
    },
  });
  const stopProgress = progressHeartbeat(worker);

  const outcome = await workflow.run(
    {
      toolId: 'audio-to-text',
      input: {
        kind: 'file',
        media: {
          name: 'sample.mp3',
          format: 'mp3',
          mimeType: 'audio/mpeg',
          bytes: sampleMp3,
        },
      },
    },
    { observe: ({ phase }) => phases.push(phase) },
  );
  stopProgress();

  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') {
    assert.equal(outcome.error.code, 'processor-failed');
    assert.match(outcome.error.message, /1 second execution limit/);
  }
  assert.deepEqual(terminal, ['failed']);
  assert.equal(phases.at(-1), 'failed');
  assert.equal(deliveries, 0);
  assert.equal(releases, 1);
  assert.equal(worker.terminated, 1);
});

test('direct-URL transcription deadline becomes one failed terminal after owned acquisition', async () => {
  const worker = new ControlledWorker();
  const endpoint = createInMemoryMediaEndpoint({
    'https://media.example/direct-speech.mp3': {
      name: 'direct-speech.mp3',
      extension: 'mp3',
      mimeType: 'audio/mpeg',
      totalBytes: sampleMp3.byteLength,
      chunks: [sampleMp3],
    },
  });
  const terminal: string[] = [];
  const workflow = createMediaWorkflow({
    endpoint,
    transcription: deadlinePort(worker),
    async deliver() {
      throw new Error('deadline path must not deliver');
    },
    telemetry: {
      async start() {},
      async terminal(_runId, status) {
        terminal.push(status);
      },
    },
    clock: { now: () => 0 },
    nextId: () => 'direct-url-deadline-run',
  });
  const stopProgress = progressHeartbeat(worker);

  const outcome = await workflow.run({
    toolId: 'audio-to-transcript',
    input: {
      kind: 'url',
      url: 'https://media.example/direct-speech.mp3',
    },
  });
  stopProgress();

  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') {
    assert.equal(outcome.error.code, 'processor-failed');
    assert.match(outcome.error.message, /1 second execution limit/);
  }
  assert.deepEqual(endpoint.requests, [
    {
      mode: 'audio',
      url: 'https://media.example/direct-speech.mp3',
    },
  ]);
  assert.deepEqual(endpoint.streams, [
    { chunksRead: 1, cancelled: false, readerLockReleased: true },
  ]);
  assert.deepEqual(terminal, ['failed']);
  assert.equal(worker.terminated, 1);
});

test('worker creation is cleaned up when runtime resource acquisition fails', async () => {
  const worker = new ControlledWorker();
  const { context } = transcriptionContext();
  context.openResource = async () => {
    throw new Error('Worker runtime unavailable');
  };

  await assert.rejects(
    deadlinePort(worker).transcribe(media, context),
    /Worker runtime unavailable/,
  );
  assert.equal(worker.terminated, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';

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

function transcriptionContext() {
  const cleanups: Array<() => Promise<void>> = [];
  return {
    cleanups,
    context: {
      signal: new AbortController().signal,
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

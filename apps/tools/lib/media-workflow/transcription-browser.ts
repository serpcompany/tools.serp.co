import {
  cleanupFFmpeg,
  extractAudioForTranscription,
} from '../convert/video.ts';
import type { ToolWorkflow, WorkflowMedia } from '../tool-workflow/index.ts';
import { createBrowserMediaWorkflow } from './browser.ts';
import type { MediaTransferProgress } from './media-endpoint.ts';
import type { TranscriptionPort } from './processors.ts';
import { withSilenceWatchdog } from './silence-watchdog.ts';

type WorkerMessage =
  | { type: 'progress'; progress?: number }
  | { type: 'result'; text?: string }
  | { type: 'error'; error?: string };

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function executionTimeoutMessage(executionTimeoutMs: number): string {
  const seconds = Math.max(1, Math.ceil(executionTimeoutMs / 1_000));
  return `Transcription exceeded the ${seconds} second execution limit. Please try a shorter file or try again.`;
}

export function createBrowserTranscriptionPort(
  options: {
    createWorker?: () => Worker;
    extractAudio?: typeof extractAudioForTranscription;
    cleanupExtraction?: typeof cleanupFFmpeg;
    silenceTimeoutMs?: number;
    executionTimeoutMs?: number;
  } = {},
): TranscriptionPort {
  const createWorker =
    options.createWorker ??
    (() =>
      new Worker(
        new URL('../../workers/transcribe.worker.js', import.meta.url),
        {
          type: 'module',
        },
      ));
  const extractAudio = options.extractAudio ?? extractAudioForTranscription;
  const cleanupExtraction = options.cleanupExtraction ?? cleanupFFmpeg;
  const silenceTimeoutMs = options.silenceTimeoutMs ?? 30_000;
  const executionTimeoutMs = options.executionTimeoutMs ?? 45_000;
  return {
    async transcribe(media, context) {
      const executionController = new AbortController();
      const signal = AbortSignal.any([
        context.signal,
        executionController.signal,
      ]);
      const executionTimer = setTimeout(
        () =>
          executionController.abort(
            new Error(executionTimeoutMessage(executionTimeoutMs)),
          ),
        executionTimeoutMs,
      );
      const abortExtraction = () => {
        void cleanupExtraction();
      };
      signal.addEventListener('abort', abortExtraction, { once: true });
      await context.registerCleanup(async () => {
        signal.removeEventListener('abort', abortExtraction);
      });
      try {
        const audioBuffer = await withSilenceWatchdog({
          signal,
          timeoutMs: silenceTimeoutMs,
          timeoutMessage: 'Transcription extraction stopped responding',
          onTimeout: cleanupExtraction,
          run: (pulse) =>
            extractAudio(arrayBufferOf(media.bytes), media.format, {
              onProgress({ ratio }) {
                pulse();
                context.reportProgress(
                  Math.min(0.45, Math.max(0, ratio) * 0.45),
                );
              },
            }),
        });
        signal.throwIfAborted();

        const worker = createWorker();
        let workerTerminated = false;
        const terminateWorker = () => {
          if (workerTerminated) return;
          workerTerminated = true;
          worker.terminate();
        };
        let removeWorkerListeners = () => {};
        try {
          await context.openResource('worker');
          await context.registerCleanup(async () => terminateWorker());
          return await withSilenceWatchdog({
            signal,
            timeoutMs: silenceTimeoutMs,
            timeoutMessage: 'Transcription worker stopped responding',
            onTimeout: terminateWorker,
            run: (pulse) =>
              new Promise<string>((resolve, reject) => {
                let settled = false;
                const finish = (callback: () => void) => {
                  if (settled) return;
                  settled = true;
                  worker.removeEventListener('message', onMessage);
                  worker.removeEventListener('error', onError);
                  callback();
                };
                const onError = (event: ErrorEvent) =>
                  finish(() =>
                    reject(
                      new Error(event.message || 'Transcription worker failed'),
                    ),
                  );
                const onMessage = (event: MessageEvent<WorkerMessage>) => {
                  const message = event.data;
                  if (message.type === 'progress') {
                    pulse();
                    const normalized = Math.min(
                      1,
                      Math.max(0, (message.progress ?? 0) / 100),
                    );
                    context.reportProgress(0.45 + normalized * 0.55);
                  } else if (message.type === 'result') {
                    finish(() => resolve(message.text ?? ''));
                  } else if (message.type === 'error') {
                    finish(() =>
                      reject(
                        new Error(message.error || 'Transcription failed'),
                      ),
                    );
                  }
                };
                worker.addEventListener('message', onMessage);
                worker.addEventListener('error', onError);
                removeWorkerListeners = () => finish(() => {});
                pulse();
                worker.postMessage({ audioBuffer }, [audioBuffer]);
              }),
          });
        } finally {
          removeWorkerListeners();
          terminateWorker();
        }
      } finally {
        clearTimeout(executionTimer);
      }
    },
  };
}

export function createBrowserTranscriptionWorkflow(
  options: {
    onDelivered?(media: WorkflowMedia): void;
    onTransfer?(progress: MediaTransferProgress): void;
  } = {},
): ToolWorkflow {
  return createBrowserMediaWorkflow({
    ...options,
    transcription: createBrowserTranscriptionPort(),
  });
}

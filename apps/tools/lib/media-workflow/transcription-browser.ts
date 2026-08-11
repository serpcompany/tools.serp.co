import {
  cleanupFFmpeg,
  extractAudioForTranscription,
} from "../convert/video.ts";
import type { ToolWorkflow, WorkflowMedia } from "../tool-workflow/index.ts";
import { createBrowserMediaWorkflow } from "./browser.ts";
import type { MediaTransferProgress } from "./media-endpoint.ts";
import type { TranscriptionPort } from "./processors.ts";

type WorkerMessage =
  | { type: "progress"; progress?: number }
  | { type: "result"; text?: string }
  | { type: "error"; error?: string };

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function createBrowserTranscriptionPort(
  options: {
    createWorker?: () => Worker;
    extractAudio?: typeof extractAudioForTranscription;
  } = {},
): TranscriptionPort {
  const createWorker =
    options.createWorker ??
    (() =>
      new Worker(
        new URL("../../workers/transcribe.worker.js", import.meta.url),
        {
          type: "module",
        },
      ));
  const extractAudio = options.extractAudio ?? extractAudioForTranscription;
  return {
    async transcribe(media, context) {
      const abortExtraction = () => {
        void cleanupFFmpeg();
      };
      context.signal.addEventListener("abort", abortExtraction, { once: true });
      await context.registerCleanup(async () => {
        context.signal.removeEventListener("abort", abortExtraction);
      });
      const audioBuffer = await extractAudio(
        arrayBufferOf(media.bytes),
        media.format,
        {
          onProgress({ ratio }) {
            context.reportProgress(Math.min(0.45, Math.max(0, ratio) * 0.45));
          },
        },
      );
      context.signal.throwIfAborted();

      const worker = createWorker();
      await context.openResource("worker");
      await context.registerCleanup(async () => worker.terminate());
      return await new Promise<string>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          context.signal.removeEventListener("abort", onAbort);
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          callback();
        };
        const onAbort = () =>
          finish(() =>
            reject(new DOMException("Transcription cancelled", "AbortError")),
          );
        const onError = (event: ErrorEvent) =>
          finish(() =>
            reject(new Error(event.message || "Transcription worker failed")),
          );
        const onMessage = (event: MessageEvent<WorkerMessage>) => {
          const message = event.data;
          if (message.type === "progress") {
            const normalized = Math.min(
              1,
              Math.max(0, (message.progress ?? 0) / 100),
            );
            context.reportProgress(0.45 + normalized * 0.55);
          } else if (message.type === "result") {
            finish(() => resolve(message.text ?? ""));
          } else if (message.type === "error") {
            finish(() =>
              reject(new Error(message.error || "Transcription failed")),
            );
          }
        };
        context.signal.addEventListener("abort", onAbort, { once: true });
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage({ audioBuffer }, [audioBuffer]);
      });
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

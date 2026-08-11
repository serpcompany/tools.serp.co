import type { WorkflowMedia, WorkflowOutcome } from "../tool-workflow/index.ts";
import { createMediaWorkflow } from "./index.ts";
import type {
  MediaEndpointPort,
  MediaEndpointRequest,
  MediaEndpointResponse,
  MediaTransferProgress,
} from "./media-endpoint.ts";

type MediaFixture = {
  chunks: Uint8Array[];
  extension?: string;
  mimeType?: string;
  name?: string;
  totalBytes?: number;
  stallAfterChunks?: number;
  error?: Error;
};

export function createInMemoryMediaEndpoint(
  fixtures: Record<string, MediaFixture>,
) {
  const requests: MediaEndpointRequest[] = [];
  const streams: Array<{
    chunksRead: number;
    cancelled: boolean;
    readerLockReleased: boolean;
  }> = [];
  const endpoint: MediaEndpointPort = {
    async open(request, signal): Promise<MediaEndpointResponse> {
      requests.push({ ...request });
      signal.throwIfAborted();
      const fixture = fixtures[request.url];
      if (!fixture) throw new Error("Media endpoint fixture is unavailable");
      if (fixture.error) throw fixture.error;
      const record = {
        chunksRead: 0,
        cancelled: false,
        readerLockReleased: false,
      };
      streams.push(record);
      let index = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (index === fixture.stallAfterChunks) return;
            const chunk = fixture.chunks[index++];
            if (chunk) {
              record.chunksRead += 1;
              controller.enqueue(chunk);
            } else controller.close();
          },
          cancel() {
            record.cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const originalGetReader = body.getReader.bind(body);
      body.getReader = ((...args: []) => {
        const reader = originalGetReader(...args);
        const releaseLock = reader.releaseLock.bind(reader);
        reader.releaseLock = () => {
          record.readerLockReleased = true;
          releaseLock();
        };
        return reader;
      }) as typeof body.getReader;
      return {
        body,
        contentLength: fixture.totalBytes,
        extension: fixture.extension,
        fileName: fixture.name,
        mimeType: fixture.mimeType,
      };
    },
  };
  return Object.assign(endpoint, { requests, streams });
}

export function createMediaWorkflowTestHarness(options: {
  media?: Record<string, MediaFixture>;
  transcript?: string;
  stallTranscription?: boolean;
}) {
  const endpoint = createInMemoryMediaEndpoint(options.media ?? {});
  const deliveries: WorkflowMedia[] = [];
  const transfers: MediaTransferProgress[] = [];
  const telemetry: Array<{
    kind: "start" | "terminal";
    status?: WorkflowOutcome["status"] | "cancelled";
  }> = [];
  let runId = 0;
  let deliveryId = 0;
  let now = 0;
  const transcriptionRecords = { aborted: false, cleanupReleased: false };
  return {
    endpoint,
    deliveries,
    transfers,
    telemetry,
    transcriptionRecords,
    workflow: createMediaWorkflow({
      endpoint,
      onTransfer(progress) {
        transfers.push(progress);
      },
      transcription: {
        async transcribe(_media, context) {
          await context.openResource("worker");
          await context.registerCleanup(async () => {
            transcriptionRecords.cleanupReleased = true;
          });
          context.signal.throwIfAborted();
          context.reportProgress(1);
          if (options.stallTranscription) {
            await new Promise<never>((_resolve, reject) => {
              const abort = () => {
                transcriptionRecords.aborted = true;
                reject(new DOMException("Transcription cancelled", "AbortError"));
              };
              context.signal.addEventListener("abort", abort, { once: true });
            });
          }
          return options.transcript ?? "Deterministic transcript.";
        },
      },
      async deliver(media) {
        deliveries.push(media);
        return `delivery-${++deliveryId}`;
      },
      telemetry: {
        async start() {
          telemetry.push({ kind: "start" });
        },
        async terminal(_runId, status) {
          telemetry.push({ kind: "terminal", status });
        },
      },
      clock: { now: () => (now += 1_000) },
      nextId(kind) {
        return kind === "run" ? `run-${++runId}` : `delivery-${++deliveryId}`;
      },
    }),
  };
}

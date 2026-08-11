import {
  createToolWorkflow,
  type RuntimeResourceKind,
  type ToolWorkflow,
  type WorkflowMedia,
  type WorkflowOutcome,
  type WorkflowRequest,
} from "../tool-workflow/index.ts";
import {
  createStreamedMediaAcquisition,
  type MediaEndpointPort,
  type MediaEndpointRequest,
  type MediaTransferProgress,
} from "./media-endpoint.ts";
import { getDownloaderAttemptPolicy } from "./attempt-policy.ts";
import { isStreamedMediaDownloaderTool } from "./eligibility.ts";
import {
  createDownloaderProcessor,
  createTranscriptionProcessor,
  TRANSCRIPTION_TOOL_IDS,
  type TranscriptionPort,
} from "./processors.ts";

type MediaWorkflowTelemetry = {
  start(runId: string, request: WorkflowRequest, at: number): Promise<void>;
  terminal(
    runId: string,
    status: WorkflowOutcome["status"] | "cancelled",
    at: number,
  ): Promise<void>;
};

export type MediaWorkflowPorts = {
  endpoint: MediaEndpointPort;
  transcription?: TranscriptionPort;
  deliver(media: WorkflowMedia): Promise<string>;
  telemetry: MediaWorkflowTelemetry;
  clock: { now(): number };
  nextId(kind: "run" | "delivery"): string;
  runtime?: {
    open(
      kind: RuntimeResourceKind,
      signal: AbortSignal,
    ): Promise<{ release(): Promise<void> }>;
  };
  onTransfer?: (progress: MediaTransferProgress) => void;
};

function isTranscriptionTool(toolId: string): boolean {
  return TRANSCRIPTION_TOOL_IDS.includes(toolId);
}

function endpointRequest(request: WorkflowRequest): MediaEndpointRequest {
  if (request.input.kind !== "url") {
    throw new TypeError("URL media acquisition requires a URL input");
  }
  if (isTranscriptionTool(request.toolId)) {
    return { mode: "audio", url: request.input.url };
  }
  const mode =
    request.options &&
    typeof request.options === "object" &&
    "mode" in request.options &&
    (request.options as { mode?: unknown }).mode === "audio"
      ? "audio"
      : "video";
  return { consumer: "downloader", mode, url: request.input.url };
}

export function createMediaWorkflow(ports: MediaWorkflowPorts): ToolWorkflow {
  return {
    run(request, options) {
      const transcription = isTranscriptionTool(request.toolId);
      const downloader = isStreamedMediaDownloaderTool(request.toolId);
      if (transcription && !ports.transcription) {
        throw new Error("The transcription workflow adapter is unavailable");
      }
      const definition = transcription
        ? createTranscriptionProcessor(request.input.kind, ports.transcription!)
        : createDownloaderProcessor(request.input.kind);
      const streamedAcquisition = createStreamedMediaAcquisition({
        endpoint: ports.endpoint,
        clock: ports.clock,
        onTransfer: ports.onTransfer,
      });
      const workflow = createToolWorkflow({
        acquisition: {
          file: {
            async acquire(input, context) {
              context.signal.throwIfAborted();
              return input.media;
            },
          },
          url: {
            acquire(_input, context) {
              const attemptPolicy = getDownloaderAttemptPolicy(request.toolId);
              if (downloader && attemptPolicy.kind === "reject") {
                throw new Error(attemptPolicy.message);
              }
              return streamedAcquisition.acquire(endpointRequest(request), context);
            },
          },
        },
        resolveIntent(toolId) {
          return (transcription || downloader) && toolId === request.toolId
            ? definition.intent
            : undefined;
        },
        resolveProcessor(toolId) {
          return (transcription || downloader) && toolId === request.toolId
            ? definition.processor
            : undefined;
        },
        deliver: ports.deliver,
        runtime: ports.runtime ?? {
          async open() {
            return { async release() {} };
          },
        },
        telemetry: ports.telemetry,
        clock: ports.clock,
        nextId: ports.nextId,
      });
      return workflow.run(request, options);
    },
  };
}

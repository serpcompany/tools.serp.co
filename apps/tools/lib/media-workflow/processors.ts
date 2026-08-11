import { executionProvenance } from "../tool-execution-provenance.ts";
import type {
  SemanticVerification,
  ToolExecutionIntent,
  ToolProcessor,
  WorkflowInput,
  WorkflowMedia,
} from "../tool-workflow/index.ts";
import {
  MAX_SEMANTIC_MEDIA_BYTES,
  verifyMediaSemantics,
} from "../tool-workflow/semantic-validators.ts";
import { getExtensionFromName } from "./media-endpoint.ts";
import {
  TRANSCRIPT_OUTPUT,
  VERIFIED_MEDIA_FORMATS,
  VERIFIED_MEDIA_MIME_TYPES,
} from "./verified-formats.ts";

const formats = VERIFIED_MEDIA_FORMATS;

function inputContracts() {
  return formats.map((format) => ({
    format,
    mimeTypes: VERIFIED_MEDIA_MIME_TYPES[format],
  }));
}

const outputContracts = inputContracts().flatMap(({ format, mimeTypes }) =>
  mimeTypes.map((mimeType) => ({ format, mimeType })),
);

function verifyMediaIdentity(
  media: WorkflowMedia,
  requiredMediaTrack: "any" | "audio",
): Promise<SemanticVerification> {
  if (!media.bytes.byteLength) {
    return Promise.resolve({ status: "rejected", message: "Media is empty" });
  }
  if (getExtensionFromName(media.name) !== media.format) {
    return Promise.resolve({
      status: "rejected",
      message: "Media filename does not match its declared format",
    });
  }
  const acceptedMimeTypes =
    VERIFIED_MEDIA_MIME_TYPES[
      media.format as keyof typeof VERIFIED_MEDIA_MIME_TYPES
    ];
  if (
    acceptedMimeTypes &&
    !acceptedMimeTypes.includes(media.mimeType)
  ) {
    return Promise.resolve({
      status: "rejected",
      message: "Media format does not match its content type",
    });
  }
  return verifyMediaSemantics(media, undefined, { requiredMediaTrack });
}

export type TranscriptionPort = Readonly<{
  transcribe(
    media: WorkflowMedia,
    context: {
      signal: AbortSignal;
      reportProgress(progress: number): void;
      registerCleanup(cleanup: () => Promise<void>): Promise<void>;
      openResource(kind: "worker"): Promise<void>;
    },
  ): Promise<string>;
}>;

function engine(id: string) {
  const resolved = executionProvenance.getEngine(id);
  if (!resolved) throw new TypeError(`Unknown execution engine: ${id}`);
  return resolved;
}

export function createDownloaderProcessor(
  acquisition: WorkflowInput["kind"],
): { processor: ToolProcessor<{ mode: "audio" | "video" }>; intent: ToolExecutionIntent } {
  return {
    intent: { requestedOperation: "download", outputs: outputContracts },
    processor: {
      engine: engine("server-media-fetch"),
      support: {
        acquisition,
        inputs: inputContracts(),
        outputs: outputContracts,
        resourceLimits: {
          maxInputBytes: MAX_SEMANTIC_MEDIA_BYTES,
          maxOutputBytes: MAX_SEMANTIC_MEDIA_BYTES,
          maxTotalOutputBytes: MAX_SEMANTIC_MEDIA_BYTES,
        },
        outputCardinality: { min: 1, max: 1 },
      },
      parseOptions(value) {
        const mode =
          value && typeof value === "object" && "mode" in value
            ? (value as { mode?: unknown }).mode
            : "video";
        return mode === "audio" || mode === "video"
          ? { ok: true, value: { mode } }
          : { ok: false, message: "Downloader mode must be audio or video" };
      },
      decideSupport() {
        return { supported: true };
      },
      verifyInput(media, _context, options) {
        return verifyMediaIdentity(
          media,
          options.mode === "audio" ? "audio" : "any",
        );
      },
      async process(input, _options, context) {
        context.signal.throwIfAborted();
        context.reportProgress(1);
        return [input];
      },
      verifyResult(media, _context, options) {
        return verifyMediaIdentity(
          media,
          options.mode === "audio" ? "audio" : "any",
        );
      },
    },
  };
}

export function createTranscriptionProcessor(
  acquisition: WorkflowInput["kind"],
  transcription: TranscriptionPort,
): { processor: ToolProcessor<Record<string, never>>; intent: ToolExecutionIntent } {
  return {
    intent: {
      requestedOperation: "transcribe",
      outputs: [TRANSCRIPT_OUTPUT],
    },
    processor: {
      engine: engine("browser-transformers-transcription"),
      support: {
        acquisition,
        inputs: inputContracts(),
        outputs: [TRANSCRIPT_OUTPUT],
        resourceLimits: {
          maxInputBytes: MAX_SEMANTIC_MEDIA_BYTES,
          maxOutputBytes: 20_000_000,
          maxTotalOutputBytes: 20_000_000,
        },
        outputCardinality: { min: 1, max: 1 },
      },
      parseOptions() {
        return { ok: true, value: {} };
      },
      decideSupport() {
        return { supported: true };
      },
      verifyInput(media) {
        return verifyMediaIdentity(media, "audio");
      },
      async process(input, _options, context) {
        const transcript = await transcription.transcribe(input, context);
        const baseName = input.name.replace(/\.[^.]+$/, "") || "transcript";
        return [
          {
            name: `${baseName}.txt`,
            ...TRANSCRIPT_OUTPUT,
            bytes: new TextEncoder().encode(transcript),
          },
        ];
      },
      verifyResult(result, context) {
        return verifyMediaSemantics(result, undefined, {
          maxBytes: context.budgets.maxOutputBytes,
          signal: context.signal,
        });
      },
    },
  };
}

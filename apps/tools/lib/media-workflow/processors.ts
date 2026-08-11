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
import { VERIFIED_MEDIA_FORMATS } from "./verified-formats.ts";

export const TRANSCRIPTION_TOOL_IDS = Object.freeze([
  "audio-to-text",
  "audio-to-transcript",
  "mp3-to-transcript",
  "mp4-to-transcript",
  "tiktok-to-transcript",
  "video-to-transcript",
  "youtube-to-transcript",
  "youtube-to-transcript-generator",
]);

const formats = VERIFIED_MEDIA_FORMATS;
const mimeTypesByFormat: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "3gp": ["audio/3gpp", "video/3gpp", "application/octet-stream"],
  m4a: ["audio/mp4", "application/octet-stream"],
  m4v: ["video/mp4", "video/x-m4v", "application/octet-stream"],
  mov: ["video/quicktime", "application/octet-stream"],
  mp3: ["audio/mpeg", "application/octet-stream"],
  mp4: ["video/mp4", "application/octet-stream"],
  webm: ["audio/webm", "video/webm", "application/octet-stream"],
});

function inputContracts() {
  return formats.map((format) => ({
    format,
    mimeTypes: mimeTypesByFormat[format] ?? [],
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
  const acceptedMimeTypes = mimeTypesByFormat[media.format];
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
      outputs: [{ format: "txt", mimeType: "text/plain" }],
    },
    processor: {
      engine: engine("browser-transformers-transcription"),
      support: {
        acquisition,
        inputs: inputContracts(),
        outputs: [{ format: "txt", mimeType: "text/plain" }],
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
            format: "txt",
            mimeType: "text/plain",
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

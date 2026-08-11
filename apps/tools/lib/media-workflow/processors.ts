import { AUDIO_FORMATS, VIDEO_FORMATS } from "../capabilities.ts";
import { executionProvenance } from "../tool-execution-provenance.ts";
import type {
  SemanticVerification,
  ToolExecutionIntent,
  ToolProcessor,
  WorkflowInput,
  WorkflowMedia,
} from "../tool-workflow/index.ts";
import { verifyMediaSemantics } from "../tool-workflow/semantic-validators.ts";
import { getExtensionFromName } from "./media-endpoint.ts";

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

const formats = Object.freeze([...new Set([...AUDIO_FORMATS, ...VIDEO_FORMATS])]);
const mimeTypesByFormat: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "3g2": ["audio/3gpp2", "video/3gpp2", "application/octet-stream"],
  "3gp": ["audio/3gpp", "video/3gpp", "application/octet-stream"],
  aac: ["audio/aac", "application/octet-stream"],
  aif: ["audio/aiff", "audio/x-aiff", "application/octet-stream"],
  aiff: ["audio/aiff", "audio/x-aiff", "application/octet-stream"],
  avi: ["video/x-msvideo", "application/octet-stream"],
  asf: ["video/x-ms-asf", "application/octet-stream"],
  flac: ["audio/flac", "audio/x-flac", "application/octet-stream"],
  flv: ["video/x-flv", "application/octet-stream"],
  m4a: ["audio/mp4", "application/octet-stream"],
  mkv: ["video/x-matroska", "application/octet-stream"],
  mov: ["video/quicktime", "application/octet-stream"],
  mp3: ["audio/mpeg", "application/octet-stream"],
  mp4: ["video/mp4", "application/octet-stream"],
  ogg: ["audio/ogg", "application/ogg", "application/octet-stream"],
  ogv: ["video/ogg", "application/ogg", "application/octet-stream"],
  opus: ["audio/opus", "audio/ogg", "application/octet-stream"],
  wav: ["audio/wav", "audio/wave", "audio/x-wav", "application/octet-stream"],
  webm: ["audio/webm", "video/webm", "application/octet-stream"],
  wmv: ["video/x-ms-wmv", "application/octet-stream"],
});

function inputContracts() {
  return formats.map((format) => ({
    format,
    mimeTypes: mimeTypesByFormat[format] ?? [
      `audio/${format}`,
      `video/${format}`,
      "application/octet-stream",
    ],
  }));
}

const outputContracts = inputContracts().flatMap(({ format, mimeTypes }) =>
  mimeTypes.map((mimeType) => ({ format, mimeType })),
);

function verifyMediaIdentity(media: WorkflowMedia): Promise<SemanticVerification> {
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
  return verifyMediaSemantics(media);
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
          maxInputBytes: 1_000_000_000,
          maxOutputBytes: 1_000_000_000,
          maxTotalOutputBytes: 1_000_000_000,
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
      verifyInput: verifyMediaIdentity,
      async process(input, _options, context) {
        context.signal.throwIfAborted();
        context.reportProgress(1);
        return [input];
      },
      verifyResult: verifyMediaIdentity,
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
          maxInputBytes: 1_000_000_000,
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
      verifyInput: verifyMediaIdentity,
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

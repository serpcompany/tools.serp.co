import { AUDIO_FORMATS, VIDEO_FORMATS } from "../capabilities.ts";
import { createDownloaderRequestHeaders } from "../downloader-client.ts";
import { DOWNLOADER_CONSUMER } from "../downloader-contract.js";
import {
  getDownloaderMediaFetchEndpoint,
  getMediaFetchEndpoint,
} from "../media-fetch-endpoint.ts";
import type { WorkflowMedia } from "../tool-workflow/index.ts";

export type MediaEndpointRequest = Readonly<{
  consumer?: "downloader";
  mode: "audio" | "video";
  url: string;
}>;

export type MediaEndpointResponse = Readonly<{
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
  extension?: string;
  fileName?: string;
  mimeType?: string;
}>;

export type MediaEndpointPort = Readonly<{
  open(
    request: MediaEndpointRequest,
    signal: AbortSignal,
  ): Promise<MediaEndpointResponse>;
}>;

export function createProductionMediaEndpoint(options: {
  fetch?: typeof fetch;
} = {}): MediaEndpointPort {
  const fetchMedia = options.fetch ?? fetch;
  return {
    async open(request, signal) {
      const downloader = request.consumer === "downloader";
      const response = await fetchMedia(
        downloader
          ? getDownloaderMediaFetchEndpoint()
          : getMediaFetchEndpoint(),
        {
          method: "POST",
          headers: downloader
            ? createDownloaderRequestHeaders()
            : { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(downloader ? { consumer: DOWNLOADER_CONSUMER } : {}),
            mode: request.mode,
            url: request.url,
          }),
          signal,
        },
      );
      if (!response.ok) {
        let detail = "";
        try {
          const payload = (await response.json()) as { error?: unknown };
          detail = typeof payload.error === "string" ? payload.error : "";
        } catch {
          // The repository endpoint is allowed to return an empty error body.
        }
        throw new Error(
          `Download failed (${response.status})${detail ? `: ${detail}` : ""}`,
        );
      }
      const body =
        response.body ??
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new Uint8Array(await response.arrayBuffer()));
            controller.close();
          },
        });
      const contentLengthValue = Number(response.headers.get("content-length"));
      return {
        body,
        contentLength:
          Number.isFinite(contentLengthValue) && contentLengthValue > 0
            ? contentLengthValue
            : undefined,
        extension: response.headers.get("x-media-extension") ?? undefined,
        fileName: response.headers.get("x-media-filename") ?? undefined,
        mimeType: response.headers.get("content-type") ?? undefined,
      };
    },
  };
}

export type MediaTransferProgress = Readonly<{
  receivedBytes: number;
  totalBytes?: number;
  ratio?: number;
  bytesPerSecond: number;
  etaSeconds?: number;
}>;

type AcquisitionContext = {
  signal: AbortSignal;
  budgets: { maxInputBytes: number };
  registerCleanup(cleanup: () => Promise<void>): Promise<void>;
  reportProgress(progress: number): void;
};

const supportedExtensions = new Set([...AUDIO_FORMATS, ...VIDEO_FORMATS]);

const extensionByMimeType: Readonly<Record<string, string>> = Object.freeze({
  "audio/aac": "aac",
  "audio/aiff": "aiff",
  "audio/3gpp": "3gp",
  "audio/3gpp2": "3g2",
  "audio/flac": "flac",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/x-aiff": "aiff",
  "audio/x-flac": "flac",
  "audio/x-m4a": "m4a",
  "audio/x-wav": "wav",
  "video/3gpp": "3gp",
  "video/3gpp2": "3g2",
  "video/mp4": "mp4",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-flv": "flv",
  "video/x-matroska": "mkv",
  "video/x-ms-asf": "asf",
  "video/x-ms-wmv": "wmv",
  "video/x-msvideo": "avi",
});

export function getExtensionFromName(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function fallbackName(url: string): string {
  const parsed = new URL(url);
  const raw = parsed.pathname.split("/").filter(Boolean).pop() || "media";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function safeMediaName(
  candidate: string | undefined,
  url: string,
  extension: string,
): string {
  const leaf = (candidate || fallbackName(url))
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop();
  const decoded = Array.from(leaf || "media")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 180);
  const withoutExtension = decoded.replace(/\.[^.]+$/, "").replace(/^\.+/, "");
  return `${withoutExtension || "media"}.${extension}`;
}

function resolveMediaIdentity(
  response: MediaEndpointResponse,
  request: MediaEndpointRequest,
): Omit<WorkflowMedia, "bytes"> {
  const mimeType = response.mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const mimeExtension = extensionByMimeType[mimeType];
  const headerExtension = response.extension?.trim().toLowerCase() ?? "";
  const nameExtension = getExtensionFromName(response.fileName ?? "");
  const extension = mimeExtension || headerExtension || nameExtension;

  if (!extension || !supportedExtensions.has(extension)) {
    throw new Error(
      mimeType.startsWith("audio/") || mimeType.startsWith("video/")
        ? "This link returns a media type we do not support yet."
        : request.consumer === "downloader"
          ? "That link does not look like a supported media file. Try another link."
          : "That link does not look like supported audio/video media.",
    );
  }
  if (
    mimeExtension &&
    headerExtension &&
    mimeExtension !== headerExtension
  ) {
    throw new Error("Media response format does not match its content type.");
  }

  return {
    name: safeMediaName(response.fileName, request.url, extension),
    format: extension,
    mimeType: mimeType || `application/octet-stream`,
  };
}

export function createStreamedMediaAcquisition(options: {
  endpoint: MediaEndpointPort;
  clock?: { now(): number };
  onTransfer?: (progress: MediaTransferProgress) => void;
}) {
  const clock = options.clock ?? { now: () => performance.now() };
  return {
    async acquire(
      request: MediaEndpointRequest,
      context: AcquisitionContext,
    ): Promise<WorkflowMedia> {
      context.signal.throwIfAborted();
      const response = await options.endpoint.open(request, context.signal);
      const reader = response.body.getReader();
      let complete = false;
      const cancelReader = () => {
        void reader.cancel(context.signal.reason).catch(() => {});
      };
      if (context.signal.aborted) cancelReader();
      else context.signal.addEventListener("abort", cancelReader, { once: true });
      await context.registerCleanup(async () => {
        context.signal.removeEventListener("abort", cancelReader);
        if (!complete) await reader.cancel().catch(() => {});
        reader.releaseLock();
      });
      context.signal.throwIfAborted();
      const identity = resolveMediaIdentity(response, request);
      if (
        response.contentLength !== undefined &&
        response.contentLength > context.budgets.maxInputBytes
      ) {
        await reader.cancel("Input byte budget exceeded");
        throw new Error(
          `Input exceeds ${context.budgets.maxInputBytes} bytes`,
        );
      }

      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      const startedAt = clock.now();
      while (true) {
        const next = await reader.read();
        if (next.done) {
          complete = true;
          break;
        }
        const chunk = next.value;
        if (receivedBytes + chunk.byteLength > context.budgets.maxInputBytes) {
          await reader.cancel("Input byte budget exceeded");
          throw new Error(
            `Input exceeds ${context.budgets.maxInputBytes} bytes`,
          );
        }
        chunks.push(chunk);
        receivedBytes += chunk.byteLength;
        const elapsedSeconds = Math.max((clock.now() - startedAt) / 1_000, 0);
        const bytesPerSecond = elapsedSeconds > 0 ? receivedBytes / elapsedSeconds : 0;
        const totalBytes = response.contentLength;
        const ratio = totalBytes ? Math.min(1, receivedBytes / totalBytes) : undefined;
        const etaSeconds =
          totalBytes && bytesPerSecond > 0
            ? Math.max(0, (totalBytes - receivedBytes) / bytesPerSecond)
            : undefined;
        if (ratio !== undefined) context.reportProgress(ratio);
        options.onTransfer?.({
          receivedBytes,
          totalBytes,
          ratio,
          bytesPerSecond,
          etaSeconds,
        });
        context.signal.throwIfAborted();
      }

      const bytes = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { ...identity, bytes };
    },
  };
}

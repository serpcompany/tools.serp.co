import { createDownloaderRequestHeaders } from "../downloader-client.ts";
import { DOWNLOADER_CONSUMER } from "../downloader-contract.js";
import {
  getDownloaderMediaFetchEndpoint,
  getMediaFetchEndpoint,
} from "../media-fetch-endpoint.ts";
import type {
  WorkflowMedia,
  WorkflowRecovery,
} from "../tool-workflow/index.ts";
import { readMediaFilename } from "../media-filename-transport.ts";
import { VERIFIED_MEDIA_FORMATS } from "./verified-formats.ts";

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

export class MediaEndpointError extends Error {
  readonly recovery?: WorkflowRecovery;

  constructor(message: string, recovery?: WorkflowRecovery) {
    super(message);
    this.name = "MediaEndpointError";
    if (recovery) this.recovery = recovery;
  }
}

export function createProductionMediaEndpoint(
  options: {
    fetch?: typeof fetch;
  } = {},
): MediaEndpointPort {
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
        let extensionRequired = false;
        try {
          const payload = (await response.json()) as {
            error?: unknown;
            extensionRequired?: unknown;
          };
          detail = typeof payload.error === "string" ? payload.error : "";
          extensionRequired = payload.extensionRequired === true;
        } catch {
          // The repository endpoint is allowed to return an empty error body.
        }
        throw new MediaEndpointError(
          `Download failed (${response.status})${detail ? `: ${detail}` : ""}`,
          extensionRequired
            ? { kind: "browser-extension-required" }
            : undefined,
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
        fileName: readMediaFilename(response.headers),
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

/**
 * Browser downloads must materialize verified bytes before delivery, and Blob
 * construction snapshots those bytes. The 32 MiB transfer cap yields a 64 MiB
 * delivery handoff (owned bytes + Blob snapshot). During unknown-length
 * acquisition, a conservative bound also includes the previous 16 MiB growth
 * owner, its 32 MiB replacement, and the still-live incoming chunk (up to
 * 32 MiB), for an 80 MiB lifecycle peak. Declared streams cannot grow beyond
 * their advertised length.
 */
export const BROWSER_MEDIA_MEMORY_BUDGET = Object.freeze({
  maxBlobSnapshotBytes: 32 * 1_024 * 1_024,
  maxDeliveryPeakBytes: 64 * 1_024 * 1_024,
  maxGrowthOwnerBytes: 16 * 1_024 * 1_024,
  maxIncomingChunkBytes: 32 * 1_024 * 1_024,
  maxLifecyclePeakBytes: 80 * 1_024 * 1_024,
  maxReplacementBytes: 32 * 1_024 * 1_024,
  maxTransferBytes: 32 * 1_024 * 1_024,
});

type AcquisitionContext = {
  signal: AbortSignal;
  budgets: { maxInputBytes: number };
  registerCleanup(cleanup: () => Promise<void>): Promise<void>;
  reportProgress(progress: number): void;
};

const supportedExtensions = new Set<string>(VERIFIED_MEDIA_FORMATS);

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
  "video/x-m4v": "m4v",
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
    .trim();
  const withoutExtension = decoded.replace(/\.[^.]+$/, "").replace(/^\.+/, "");
  const suffix = `.${extension}`;
  const maxStemCodePoints = Math.max(1, 180 - Array.from(suffix).length);
  const boundedStem = Array.from(withoutExtension || "media")
    .slice(0, maxStemCodePoints)
    .join("");
  return `${boundedStem}.${extension}`;
}

function resolveMediaIdentity(
  response: MediaEndpointResponse,
  request: MediaEndpointRequest,
): Omit<WorkflowMedia, "bytes"> {
  const mimeType = response.mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const mimeExtension = extensionByMimeType[mimeType];
  const headerExtension = response.extension?.trim().toLowerCase() ?? "";
  const nameExtension = getExtensionFromName(response.fileName ?? "");
  const declaredExtension = headerExtension || nameExtension;
  const compatibleM4vAlias =
    mimeExtension === "mp4" && declaredExtension === "m4v";
  const extension = compatibleM4vAlias
    ? declaredExtension
    : mimeExtension || declaredExtension;

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
    mimeExtension !== headerExtension &&
    !compatibleM4vAlias
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
  allocateBuffer?: (bytes: number) => Uint8Array;
}) {
  const clock = options.clock ?? { now: () => performance.now() };
  const allocateBuffer =
    options.allocateBuffer ?? ((bytes: number) => new Uint8Array(bytes));
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
      else
        context.signal.addEventListener("abort", cancelReader, { once: true });
      await context.registerCleanup(async () => {
        context.signal.removeEventListener("abort", cancelReader);
        if (!complete) await reader.cancel().catch(() => {});
        reader.releaseLock();
      });
      context.signal.throwIfAborted();
      const identity = resolveMediaIdentity(response, request);
      const maxTransferBytes = Math.min(
        context.budgets.maxInputBytes,
        BROWSER_MEDIA_MEMORY_BUDGET.maxTransferBytes,
      );
      if (
        response.contentLength !== undefined &&
        response.contentLength > maxTransferBytes
      ) {
        await reader.cancel("Input byte budget exceeded");
        throw new Error(`Input exceeds ${maxTransferBytes} bytes`);
      }

      const declaredLength = response.contentLength;
      let ownedBuffer =
        declaredLength === undefined
          ? undefined
          : allocateBuffer(declaredLength);
      if (
        declaredLength !== undefined &&
        ownedBuffer?.byteLength !== declaredLength
      ) {
        throw new Error(
          `Media buffer allocator returned ${ownedBuffer?.byteLength ?? 0} bytes; expected ${declaredLength}`,
        );
      }
      let receivedBytes = 0;
      const startedAt = clock.now();
      while (true) {
        const next = await reader.read();
        if (next.done) {
          complete = true;
          break;
        }
        const chunk = next.value;
        if (receivedBytes + chunk.byteLength > maxTransferBytes) {
          await reader.cancel("Input byte budget exceeded");
          throw new Error(`Input exceeds ${maxTransferBytes} bytes`);
        }
        const requiredBytes = receivedBytes + chunk.byteLength;
        if (declaredLength !== undefined && requiredBytes > declaredLength) {
          await reader.cancel("Media stream exceeded declared length");
          throw new Error(
            `Media stream exceeded its declared ${declaredLength} bytes`,
          );
        }
        if (!ownedBuffer || requiredBytes > ownedBuffer.byteLength) {
          // Unknown-length bodies grow geometrically from a small allocation.
          // Only the current owned prefix and its replacement coexist during
          // growth; no chunk list or EOF coalescing allocation is retained.
          let capacity = Math.min(64 * 1_024, maxTransferBytes);
          while (capacity < requiredBytes) {
            capacity = Math.min(maxTransferBytes, capacity * 2);
          }
          const replacement = allocateBuffer(capacity);
          if (replacement.byteLength !== capacity) {
            throw new Error(
              `Media buffer allocator returned ${replacement.byteLength} bytes; expected ${capacity}`,
            );
          }
          if (ownedBuffer) {
            replacement.set(ownedBuffer.subarray(0, receivedBytes));
          }
          ownedBuffer = replacement;
        }
        ownedBuffer.set(chunk, receivedBytes);
        receivedBytes += chunk.byteLength;
        const elapsedSeconds = Math.max((clock.now() - startedAt) / 1_000, 0);
        const bytesPerSecond =
          elapsedSeconds > 0 ? receivedBytes / elapsedSeconds : 0;
        const totalBytes = response.contentLength;
        const ratio = totalBytes
          ? Math.min(1, receivedBytes / totalBytes)
          : undefined;
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

      if (
        response.contentLength !== undefined &&
        receivedBytes !== response.contentLength
      ) {
        throw new Error(
          `Media stream ended at ${receivedBytes} bytes; expected ${response.contentLength}`,
        );
      }

      return {
        ...identity,
        bytes: !ownedBuffer
          ? new Uint8Array(0)
          : receivedBytes === ownedBuffer.byteLength
            ? ownedBuffer
            : ownedBuffer.subarray(0, receivedBytes),
      };
    },
  };
}

import { detectCapabilities } from "../capabilities.ts";
import { resolveCompressionDispatch } from "../compression-utils.ts";
import { decodeToRGBA } from "./decode.ts";
import { encodeFromRGBA } from "./encode.ts";
import { createServerActionRequestHeaders } from "../server-action-client.ts";
import {
  resolveConversionDispatch,
  type ConversionOp,
} from "./conversion-dispatch.ts";

export { resolveConversionOp } from "./conversion-dispatch.ts";
export type { ConversionOp } from "./conversion-dispatch.ts";

export type ConversionResult =
  | { kind: "single"; buffer: ArrayBuffer }
  | { kind: "multiple"; buffers: ArrayBuffer[] };

export type ProgressUpdate = {
  status?: string;
  progress?: number;
  time?: number;
};

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  ico: "image/x-icon",
  cur: "image/x-icon",
  svg: "image/svg+xml",
  tga: "image/x-tga",
  dds: "image/vnd-ms.dds",
  mp4: "video/mp4",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  m4v: "video/x-m4v",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  aac: "audio/aac",
  m4a: "audio/mp4",
  m4r: "audio/mp4",
  opus: "audio/opus",
  flac: "audio/flac",
  wma: "audio/x-ms-wma",
  aiff: "audio/aiff",
  mp2: "audio/mpeg",
  alac: "audio/mp4",
  amr: "audio/amr",
  au: "audio/basic",
  caf: "audio/x-caf",
  cdda: "audio/x-cdda",
  ts: "video/mp2t",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  flv: "video/x-flv",
  f4v: "video/x-f4v",
  vob: "video/dvd",
  "3gp": "video/3gpp",
  hevc: "video/mp4",
  divx: "video/avi",
  mjpeg: "video/x-motion-jpeg",
  mpeg2: "video/mpeg",
  asf: "video/x-ms-asf",
  wmv: "video/x-ms-wmv",
  ogv: "video/ogg",
  rm: "application/vnd.rn-realmedia",
  rmvb: "application/vnd.rn-realmedia-vbr",
  swf: "application/x-shockwave-flash",
  mxf: "application/mxf",
  av1: "video/mp4",
  avchd: "video/mp2t",
  pdf: "application/pdf",
  txt: "text/plain",
};

export function getOutputMimeType(format: string) {
  return MIME_MAP[format.toLowerCase()] ?? "application/octet-stream";
}

type WorkerMessage = {
  type?: "progress";
  status?: string;
  progress?: number;
  time?: number;
  ok?: boolean;
  error?: string;
  blob?: ArrayBuffer;
  blobs?: ArrayBuffer[];
};

type TelemetryError = Error & {
  telemetryCode?: string;
  telemetryMetadata?: Record<string, unknown>;
};

function createTelemetryError(
  code: string,
  message: string,
  metadata?: Record<string, unknown>
): TelemetryError {
  const error = new Error(message) as TelemetryError;
  error.telemetryCode = code;
  if (metadata) {
    error.telemetryMetadata = metadata;
  }
  return error;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function convertWithWorker(args: {
  worker: Worker;
  from: string;
  to: string;
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  quality?: number;
  signal?: AbortSignal;
}): Promise<ConversionResult> {
  const fromExt = args.from.toLowerCase();
  const toExt = args.to.toLowerCase();
  const dispatch = resolveConversionDispatch(fromExt, toExt);
  switch (dispatch.kind) {
    case "browser-pdf-pages": {
      const { renderPdfPages } = await import("./pdf");
      const rasterFormat =
        fromExt === "ai"
          ? toExt === "jpg" || toExt === "jpeg"
            ? "jpg"
            : "png"
          : args.to;
      const buffers = await renderPdfPages(args.buf, undefined, rasterFormat);
      if (fromExt === "ai" && toExt === "svg") {
        const svgBuffers = [];
        for (const buffer of buffers) {
          const rgba = await decodeToRGBA("png", buffer);
          const blob = await encodeFromRGBA(
            "svg",
            rgba,
            args.quality ?? 0.85,
          );
          svgBuffers.push(await blob.arrayBuffer());
        }
        return { kind: "multiple", buffers: svgBuffers };
      }
      return { kind: "multiple", buffers };
    }
    case "server-image":
      return convertImageViaApi(args);
    case "server-assisted-image": {
      const serverResult = await convertImageViaApi({ ...args, to: "png" });
      if (serverResult.kind !== "single") {
        throw new Error(
          "Server image conversion returned multiple buffers unexpectedly.",
        );
      }
      args.onProgress?.({ status: "processing", progress: 90 });
      return convertRasterOnMainThread({
        from: "png",
        to: args.to,
        buf: serverResult.buffer,
        quality: args.quality,
      });
    }
    case "adaptive-video":
      return convertVideoOnMainThread(args);
    case "browser-raster":
      break;
  }

  if (fromExt === "heic" || fromExt === "heif") {
    return convertRasterOnMainThread(args);
  }
  const workerBuf = args.buf.slice(0);

  try {
    return await convertWithWorkerInner({
      ...args,
      op: "raster",
      buf: workerBuf,
    });
  } catch (error) {
    if (isDecodeError(error) || isWorkerError(error)) {
      return convertRasterOnMainThread(args);
    }
    throw error;
  }
}

async function convertWithWorkerInner(args: {
  worker: Worker;
  from: string;
  to: string;
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  quality?: number;
  signal?: AbortSignal;
  op: ConversionOp;
}): Promise<ConversionResult> {
  return await new Promise<ConversionResult>((resolve, reject) => {
    const settle = <Value>(callback: (value: Value) => void, value: Value) => {
      args.signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      args.worker.terminate();
      settle(reject, args.signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    if (args.signal?.aborted) {
      onAbort();
      return;
    }
    args.signal?.addEventListener("abort", onAbort, { once: true });
    args.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      if (!ev.data) {
        return settle(reject, new Error("Malformed worker response"));
      }

      if (ev.data?.type === "progress") {
        args.onProgress?.({
          status: ev.data.status,
          progress: ev.data.progress,
          time: ev.data.time,
        });
        return;
      }

      if (!ev.data?.ok) {
        return settle(
          reject,
          createTelemetryError(
            "worker_convert_failed",
            ev.data?.error || "Convert failed",
            { op: args.op, from: args.from, to: args.to, engine: "worker" }
          ),
        );
      }

      if (ev.data.blobs) {
        return settle(resolve, { kind: "multiple", buffers: ev.data.blobs });
      }

      if (ev.data.blob) {
        return settle(resolve, { kind: "single", buffer: ev.data.blob });
      }

      return settle(reject, new Error("Unknown worker response"));
    };

    args.worker.onerror = (error) => {
      const detailParts = [
        (error as ErrorEvent).message,
        (error as ErrorEvent).filename,
        (error as ErrorEvent).lineno,
        (error as ErrorEvent).colno,
        (error as ErrorEvent).error instanceof Error ? (error as ErrorEvent).error.message : null,
      ].filter(Boolean);
      const detail = detailParts.length ? detailParts.join(" | ") : String(error);
      settle(
        reject,
        createTelemetryError(
          "worker_error",
          `Worker error: ${detail}`,
          {
            op: args.op,
            from: args.from,
            to: args.to,
            engine: "worker",
            detail,
          }
        ),
      );
    };

    if (args.op === "pdf-pages") {
      args.worker.postMessage(
        { op: args.op, to: args.to, buf: args.buf, quality: args.quality },
        [args.buf]
      );
      return;
    }

    args.worker.postMessage(
      { op: args.op, from: args.from, to: args.to, buf: args.buf, quality: args.quality },
      [args.buf]
    );
  });
}

export async function compressPngWithWorker(args: {
  worker: Worker;
  buf: ArrayBuffer;
  quality?: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  const workerBuf = args.buf.slice(0);
  try {
    return await compressPngWithWorkerInner({ ...args, buf: workerBuf });
  } catch (error) {
    if (args.signal?.aborted) throw error;
    return await compressPngOnMainThread(args);
  }
}

export async function compressImageWithWorker(args: {
  worker: Worker;
  format: string;
  buf: ArrayBuffer;
  quality?: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  const workerBuf = args.buf.slice(0);
  try {
    return await compressImageWithWorkerInner({ ...args, buf: workerBuf });
  } catch (error) {
    if (args.signal?.aborted) throw error;
    return await compressImageOnMainThread(args);
  }
}

async function compressPngWithWorkerInner(args: {
  worker: Worker;
  buf: ArrayBuffer;
  quality?: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const cleanup = () => args.signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      args.worker.terminate();
      cleanup();
      reject(args.signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    if (args.signal?.aborted) return onAbort();
    args.signal?.addEventListener("abort", onAbort, { once: true });
    args.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      cleanup();
      if (!ev.data) {
        return reject(new Error("Malformed worker response"));
      }

      if (!ev.data?.ok) {
        return reject(new Error(ev.data?.error || "Compression failed"));
      }

      if (ev.data.blob) {
        return resolve(ev.data.blob as ArrayBuffer);
      }

      return reject(new Error("Unknown worker response"));
    };

    args.worker.onerror = (error) => {
      cleanup();
      const detailParts = [
        (error as ErrorEvent).message,
        (error as ErrorEvent).filename,
        (error as ErrorEvent).lineno,
        (error as ErrorEvent).colno,
        (error as ErrorEvent).error instanceof Error ? (error as ErrorEvent).error.message : null,
      ].filter(Boolean);
      const detail = detailParts.length ? detailParts.join(" | ") : String(error);
      reject(new Error(`Worker error: ${detail}`));
    };

    args.worker.postMessage({ op: "compress-png", buf: args.buf, quality: args.quality }, [args.buf]);
  });
}

async function compressImageWithWorkerInner(args: {
  worker: Worker;
  format: string;
  buf: ArrayBuffer;
  quality?: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const cleanup = () => args.signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      args.worker.terminate();
      cleanup();
      reject(args.signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    if (args.signal?.aborted) return onAbort();
    args.signal?.addEventListener("abort", onAbort, { once: true });
    args.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      cleanup();
      if (!ev.data) {
        return reject(new Error("Malformed worker response"));
      }

      if (!ev.data?.ok) {
        return reject(new Error(ev.data?.error || "Compression failed"));
      }

      if (ev.data.blob) {
        return resolve(ev.data.blob as ArrayBuffer);
      }

      return reject(new Error("Unknown worker response"));
    };

    args.worker.onerror = (error) => {
      cleanup();
      const detailParts = [
        (error as ErrorEvent).message,
        (error as ErrorEvent).filename,
        (error as ErrorEvent).lineno,
        (error as ErrorEvent).colno,
        (error as ErrorEvent).error instanceof Error ? (error as ErrorEvent).error.message : null,
      ].filter(Boolean);
      const detail = detailParts.length ? detailParts.join(" | ") : String(error);
      reject(new Error(`Worker error: ${detail}`));
    };

    args.worker.postMessage(
      { op: "compress-image", format: args.format, buf: args.buf, quality: args.quality },
      [args.buf]
    );
  });
}

function isDecodeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return [
    "natively supported",
    "decode",
    "decoded",
    "createimagebitmap",
    "imagedecoder",
  ].some((marker) => normalized.includes(marker));
}

function isWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("worker error");
}

async function convertImageViaApi(args: {
  from: string;
  to: string;
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  signal?: AbortSignal;
}): Promise<ConversionResult> {
  const route = "/api/image-convert";
  const baseMetadata = {
    route,
    from: args.from,
    to: args.to,
    engine: "server-image",
  };
  args.onProgress?.({ status: "processing", progress: 5 });
  let response: Response;
  try {
    response = await fetch(`${route}?from=${args.from}&to=${args.to}`, {
      method: "POST",
      headers: createServerActionRequestHeaders({
        "Content-Type": "application/octet-stream",
      }),
      body: args.buf,
      signal: args.signal,
    });
  } catch (error) {
    throw createTelemetryError(
      "network_error",
      "Server conversion request failed",
      { ...baseMetadata, detail: toErrorMessage(error) }
    );
  }

  if (!response.ok) {
    let detail = "";
    let serverError: string | null = null;
    try {
      const data = await response.json();
      serverError = data?.error ? String(data.error) : null;
      detail = serverError ? `: ${serverError}` : "";
    } catch {
      detail = "";
    }
    throw createTelemetryError(
      "server_convert_failed",
      `Server conversion failed (${response.status})${detail}`,
      { ...baseMetadata, status: response.status, detail: serverError }
    );
  }

  const buffer = await response.arrayBuffer();
  args.onProgress?.({ status: "processing", progress: 100 });
  return { kind: "single", buffer };
}

export async function compressPdfViaApi(args: {
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  const route = "/api/pdf-compress";
  const baseMetadata = {
    route,
    format: "pdf",
    engine: "server-pdf",
  };
  args.onProgress?.({ status: "processing", progress: 5 });
  let response: Response;
  try {
    response = await fetch(route, {
      method: "POST",
      headers: createServerActionRequestHeaders({
        "Content-Type": "application/pdf",
      }),
      body: args.buf,
      signal: args.signal,
    });
  } catch (error) {
    throw createTelemetryError(
      "network_error",
      "Server compression request failed",
      { ...baseMetadata, detail: toErrorMessage(error) }
    );
  }

  if (!response.ok) {
    let detail = "";
    let serverError: string | null = null;
    try {
      const data = await response.json();
      serverError = data?.error ? String(data.error) : null;
      detail = serverError ? `: ${serverError}` : "";
    } catch {
      detail = "";
    }
    throw createTelemetryError(
      "server_compress_failed",
      `Server compression failed (${response.status})${detail}`,
      { ...baseMetadata, status: response.status, detail: serverError }
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength >= args.buf.byteLength) {
    return args.buf;
  }
  args.onProgress?.({ status: "processing", progress: 100 });
  return buffer;
}

async function compressImageViaApi(args: {
  buf: ArrayBuffer;
  format: string;
  onProgress?: (update: ProgressUpdate) => void;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  const format = args.format.toLowerCase();
  const route = "/api/image-compress";
  const baseMetadata = {
    route,
    format,
    engine: "server-image-compress",
  };
  args.onProgress?.({ status: "processing", progress: 5 });
  let response: Response;
  try {
    response = await fetch(`${route}?format=${encodeURIComponent(format)}`, {
      method: "POST",
      headers: createServerActionRequestHeaders({
        "Content-Type": "application/octet-stream",
      }),
      body: args.buf,
      signal: args.signal,
    });
  } catch (error) {
    throw createTelemetryError(
      "network_error",
      "Server image compression request failed",
      { ...baseMetadata, detail: toErrorMessage(error) }
    );
  }

  if (!response.ok) {
    let detail = "";
    let serverError: string | null = null;
    try {
      const data = await response.json();
      serverError = data?.error ? String(data.error) : null;
      detail = serverError ? `: ${serverError}` : "";
    } catch {
      detail = "";
    }
    throw createTelemetryError(
      "server_compress_failed",
      `Server image compression failed (${response.status})${detail}`,
      { ...baseMetadata, status: response.status, detail: serverError }
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength >= args.buf.byteLength) {
    return args.buf;
  }
  args.onProgress?.({ status: "processing", progress: 100 });
  return buffer;
}

async function convertRasterOnMainThread(args: {
  from: string;
  to: string;
  buf: ArrayBuffer;
  quality?: number;
}): Promise<ConversionResult> {
  const rgba = await decodeToRGBA(args.from, args.buf);
  const blob = await encodeFromRGBA(args.to, rgba, args.quality ?? 0.85);
  const buffer = await blob.arrayBuffer();
  return { kind: "single", buffer };
}

async function convertVideoOnMainThread(args: {
  from: string;
  to: string;
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  quality?: number;
  signal?: AbortSignal;
}): Promise<ConversionResult> {
  const { convertVideo, convertVideoViaApi, shouldUseServerConversion } = await import("./video");
  const preferServer = shouldUseServerConversion(args.from, args.to);
  const canUseClient = detectCapabilities().supportsVideoConversion;
  const plan = resolveAdaptiveVideoExecution({ preferServer, canUseClient });
  let lastError: unknown;
  for (const target of plan) {
    args.signal?.throwIfAborted();
    try {
      const buffer =
        target === "server"
          ? await convertVideoViaApi(args.buf, args.from, args.to, args.signal)
          : await convertVideo(args.buf, args.from, args.to, {
              quality: args.quality,
              signal: args.signal,
              onProgress: (progress) => {
                args.onProgress?.({
                  status: "processing",
                  progress: progress.ratio * 100,
                  time: progress.time,
                });
              },
            });
      args.onProgress?.({ status: "processing", progress: 100 });
      return { kind: "single", buffer };
    } catch (error) {
      if (args.signal?.aborted) throw error;
      lastError = error;
      console.warn(`${target} conversion failed; trying adaptive fallback.`, error);
    }
  }
  throw lastError ?? new Error("No adaptive media execution target is available");
}

export function resolveAdaptiveVideoExecution(args: {
  preferServer: boolean;
  canUseClient: boolean;
}): readonly ("browser" | "server")[] {
  if (!args.canUseClient) return ["server"];
  return args.preferServer ? ["server", "browser"] : ["browser", "server"];
}

export async function compressMediaOnMainThread(args: {
  format: string;
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  quality?: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  const { compressMedia } = await import("./video");
  const buffer = await compressMedia(args.buf, args.format, {
    quality: args.quality,
    signal: args.signal,
    onProgress: (progress) => {
      args.onProgress?.({
        status: "processing",
        progress: progress.ratio * 100,
        time: progress.time,
      });
    },
  });
  return buffer;
}

async function compressPngOnMainThread(args: {
  buf: ArrayBuffer;
  quality?: number;
}): Promise<ArrayBuffer> {
  const original = args.buf;
  const colorCount = qualityToColorCount(args.quality ?? 0.85);

  try {
    const { default: UPNG } = await import("upng-js");
    const img = UPNG.decode(original);
    const frames = UPNG.toRGBA8(img);
    const frame = frames[0];
    if (!frame) {
      return original;
    }
    const output = UPNG.encode([frame], img.width, img.height, colorCount);
    if (output.byteLength >= original.byteLength) {
      return original;
    }
    return output;
  } catch {
    return original;
  }
}

async function compressImageOnMainThread(args: {
  format: string;
  buf: ArrayBuffer;
  quality?: number;
}): Promise<ArrayBuffer> {
  const original = args.buf;
  try {
    const rgba = await decodeToRGBA(args.format, args.buf);
    const blob = await encodeFromRGBA(args.format, rgba, args.quality ?? 0.8);
    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength >= original.byteLength) {
      return original;
    }
    return buffer;
  } catch {
    return original;
  }
}

export async function compressFile(args: {
  worker?: Worker;
  format: string;
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  quality?: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  const { target } = resolveCompressionDispatch(args.format);
  if (target === "image-worker") {
    if (!args.worker) {
      throw new Error("Compression worker is required for image formats.");
    }
    if (args.format.toLowerCase() === "png") {
      return compressPngWithWorker({
        worker: args.worker,
        buf: args.buf,
        quality: args.quality,
        signal: args.signal,
      });
    }
    return compressImageWithWorker({
      worker: args.worker,
      format: args.format,
      buf: args.buf,
      quality: args.quality,
      signal: args.signal,
    });
  }
  if (target === "image-server") {
    return compressImageViaApi({
      buf: args.buf,
      format: args.format,
      onProgress: args.onProgress,
      signal: args.signal,
    });
  }
  if (target === "pdf") {
    return compressPdfViaApi({
      buf: args.buf,
      onProgress: args.onProgress,
      signal: args.signal,
    });
  }
  if (target === "audio" || target === "video") {
    return compressMediaOnMainThread({
      format: args.format,
      buf: args.buf,
      onProgress: args.onProgress,
      quality: args.quality,
      signal: args.signal,
    });
  }
  throw new Error(`Compression not supported for ${args.format}`);
}

function qualityToColorCount(quality: number) {
  const clamped = Math.max(0, Math.min(1, quality));
  if (clamped >= 0.99) {
    return 0;
  }
  return Math.max(16, Math.round(clamped * 256));
}

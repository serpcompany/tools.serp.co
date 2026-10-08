import { detectCapabilities, requiresVideoConversion } from "../capabilities.ts";
import { resolveCompressionTarget } from "../compression-utils.ts";
import { decodeToRGBA } from "./decode.ts";
import { encodeFromRGBA } from "./encode.ts";
import { MAGICK_BROWSER_INPUTS } from "./magickBrowser.ts";
import { checkOutputFormat } from "./output-format.ts";
import { usesWebCodecs } from "./webcodecs.ts";
import { createServerActionRequestHeaders } from "../server-action-client.ts";
import type { ToolRunMetadata } from "@serp-tools/tool-telemetry";

export type ConversionOp = "raster" | "pdf-pages" | "video";

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
  // Elementary streams: Annex B H.265, and AV1 in IVF.
  hevc: "video/h265",
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
  av1: "video/x-ivf",
  avchd: "video/mp2t",
  pdf: "application/pdf",
  txt: "text/plain",
};

export function getOutputMimeType(format: string) {
  return MIME_MAP[format.toLowerCase()] ?? "application/octet-stream";
}

export function resolveConversionOp(from: string, to: string): ConversionOp {
  if (from === "pdf") return "pdf-pages";
  if (requiresVideoConversion(from, to)) {
    return "video";
  }
  return "raster";
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
  telemetryMetadata?: ToolRunMetadata;
};

function createTelemetryError(
  code: string,
  message: string,
  metadata?: ToolRunMetadata
): TelemetryError {
  const error = new Error(message) as TelemetryError;
  error.telemetryCode = code;
  if (metadata) {
    error.telemetryMetadata = metadata;
  }
  return error;
}

type ConvertArgs = {
  worker: Worker;
  from: string;
  to: string;
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  quality?: number;
};

// Converts, then refuses output that isn't the promised format, so a tool can
// never download (or report as a success) bytes with the wrong extension.
export async function convertWithWorker(args: ConvertArgs): Promise<ConversionResult> {
  const result = await convertUnchecked(args);
  const buffers = result.kind === "single" ? [result.buffer] : result.buffers;
  for (const buffer of buffers) {
    const check = checkOutputFormat(buffer, args.to);
    if (!check.ok) {
      throw createTelemetryError(
        "wrong_output_format",
        `The converter produced ${check.detected.toUpperCase()} instead of ${check.expected.toUpperCase()}.`,
        { from: args.from, to: args.to, format: check.detected },
      );
    }
  }
  return result;
}

async function convertUnchecked(args: ConvertArgs): Promise<ConversionResult> {
  const fromExt = args.from.toLowerCase();
  const toExt = args.to.toLowerCase();
  if (fromExt === "ai") {
    return convertAi(args.buf, toExt, args.quality);
  }
  if (MAGICK_BROWSER_INPUTS.has(fromExt)) {
    args.onProgress?.({ status: "processing", progress: 5 });
    const { convertWithMagickInBrowser } = await import("./magickBrowser.ts");
    let converted: { buffer: ArrayBuffer; format: string };
    try {
      converted = await convertWithMagickInBrowser(args.buf, fromExt, toExt);
    } catch (error) {
      throw createTelemetryError(
        "convert_failed",
        error instanceof Error ? error.message : String(error),
        { from: args.from, to: args.to, engine: "browser-magick" },
      );
    }
    if (converted.format === toExt) {
      args.onProgress?.({ status: "processing", progress: 100 });
      return { kind: "single", buffer: converted.buffer };
    }
    args.onProgress?.({ status: "processing", progress: 90 });
    return convertRasterOnMainThread({
      from: "png",
      to: args.to,
      buf: converted.buffer,
      quality: args.quality,
    });
  }
  if (fromExt === "heic" || fromExt === "heif") {
    return convertRasterOnMainThread(args);
  }
  if (fromExt === "pdf") {
    const { renderPdfPages } = await import("./pdf");
    const buffers = await renderPdfPages(args.buf, undefined, args.to);
    return { kind: "multiple", buffers };
  }
  const op = resolveConversionOp(args.from, args.to);
  if (op === "video") {
    return convertVideoOnMainThread(args);
  }
  const workerBuf = op === "raster" ? args.buf.slice(0) : args.buf;

  try {
    return await convertWithWorkerInner({ ...args, op, buf: workerBuf });
  } catch (error) {
    if (op === "raster" && (isDecodeError(error) || isWorkerError(error))) {
      return convertRasterOnMainThread(args);
    }
    throw error;
  }
}

// Illustrator writes every AI file as a PDF unless "Create PDF Compatible
// File" is turned off; older AI files are PostScript, which pdf.js can't read.
// The PDF is the AI to PDF result as it is, vectors included; other formats
// are encoded from the pages pdf.js renders.
async function convertAi(buf: ArrayBuffer, to: string, quality?: number): Promise<ConversionResult> {
  if (!checkOutputFormat(buf, "pdf").ok) {
    throw createTelemetryError(
      "unsupported_input",
      "This AI file has no PDF inside. In Illustrator, save it again with Create PDF Compatible File turned on.",
      { from: "ai", to, engine: "pdfjs" },
    );
  }
  if (to === "pdf") {
    return { kind: "single", buffer: buf };
  }

  const { renderPdfPages } = await import("./pdf");
  const rendered = to === "jpg" || to === "jpeg" ? "jpg" : "png";
  const pages = await renderPdfPages(buf, undefined, rendered);
  if (to === rendered || to === "jpeg") {
    return { kind: "multiple", buffers: pages };
  }
  const buffers = [];
  for (const page of pages) {
    const rgba = await decodeToRGBA("png", page);
    const blob = await encodeFromRGBA(to, rgba, quality ?? 0.85);
    buffers.push(await blob.arrayBuffer());
  }
  return { kind: "multiple", buffers };
}

async function convertWithWorkerInner(args: {
  worker: Worker;
  from: string;
  to: string;
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  quality?: number;
  op: ConversionOp;
}): Promise<ConversionResult> {
  return await new Promise<ConversionResult>((resolve, reject) => {
    args.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      if (!ev.data) {
        return reject(new Error("Malformed worker response"));
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
        return reject(
          createTelemetryError(
            "worker_convert_failed",
            ev.data?.error || "Convert failed",
            { op: args.op, from: args.from, to: args.to, engine: "worker" }
          )
        );
      }

      if (ev.data.blobs) {
        return resolve({ kind: "multiple", buffers: ev.data.blobs });
      }

      if (ev.data.blob) {
        return resolve({ kind: "single", buffer: ev.data.blob });
      }

      return reject(new Error("Unknown worker response"));
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
      reject(
        createTelemetryError(
          "worker_error",
          `Worker error: ${detail}`,
          {
            op: args.op,
            from: args.from,
            to: args.to,
            engine: "worker",
          }
        )
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
}): Promise<ArrayBuffer> {
  const workerBuf = args.buf.slice(0);
  try {
    return await compressPngWithWorkerInner({ ...args, buf: workerBuf });
  } catch {
    return await compressPngOnMainThread(args);
  }
}

export async function compressImageWithWorker(args: {
  worker: Worker;
  format: string;
  buf: ArrayBuffer;
  quality?: number;
}): Promise<ArrayBuffer> {
  const workerBuf = args.buf.slice(0);
  try {
    return await compressImageWithWorkerInner({ ...args, buf: workerBuf });
  } catch {
    return await compressImageOnMainThread(args);
  }
}

async function compressPngWithWorkerInner(args: {
  worker: Worker;
  buf: ArrayBuffer;
  quality?: number;
}): Promise<ArrayBuffer> {
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    args.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
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
}): Promise<ArrayBuffer> {
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    args.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
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

export async function compressPdfViaApi(args: {
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
}): Promise<ArrayBuffer> {
  const route = "/api/pdf-compress";
  const baseMetadata: ToolRunMetadata = {
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
    });
  } catch {
    throw createTelemetryError(
      "network_error",
      "Server compression request failed",
      baseMetadata
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
      { ...baseMetadata, status: response.status }
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength >= args.buf.byteLength) {
    return args.buf;
  }
  args.onProgress?.({ status: "processing", progress: 100 });
  return buffer;
}

async function compressImageInBrowserWithTelemetry(args: {
  buf: ArrayBuffer;
  format: string;
  quality?: number;
  onProgress?: (update: ProgressUpdate) => void;
}): Promise<ArrayBuffer> {
  const format = args.format.toLowerCase();
  args.onProgress?.({ status: "processing", progress: 5 });
  try {
    const { compressImageInBrowser } = await import("./image-compress");
    const output = await compressImageInBrowser(args.buf, format, args.quality);
    args.onProgress?.({ status: "processing", progress: 100 });
    return output;
  } catch (error) {
    throw createTelemetryError(
      "compress_failed",
      error instanceof Error ? error.message : "Image compression failed",
      { format, engine: format === "svg" ? "svgo" : "imagemagick-wasm" },
    );
  }
}

async function compressImageViaApi(args: {
  buf: ArrayBuffer;
  format: string;
  onProgress?: (update: ProgressUpdate) => void;
}): Promise<ArrayBuffer> {
  const format = args.format.toLowerCase();
  const route = "/api/image-compress";
  const baseMetadata: ToolRunMetadata = {
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
    });
  } catch {
    throw createTelemetryError(
      "network_error",
      "Server image compression request failed",
      baseMetadata
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
      { ...baseMetadata, status: response.status }
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
}): Promise<ConversionResult> {
  if (usesWebCodecs(args.from, args.to)) {
    const { convertWithWebCodecs } = await import("./webcodecs-convert.ts");
    const buffer = await convertWithWebCodecs(args.buf, args.from, args.to, (progress) =>
      args.onProgress?.({ status: "processing", progress }),
    );
    return { kind: "single", buffer };
  }
  const { convertVideo, convertVideoViaApi, shouldUseServerConversion } = await import("./video");
  let buffer: ArrayBuffer;

  const preferServer = shouldUseServerConversion(args.from, args.to);
  const canUseClient = detectCapabilities().supportsVideoConversion;

  if (preferServer) {
    args.onProgress?.({ status: "processing", progress: 5 });
    try {
      buffer = await convertVideoViaApi(args.buf, args.from, args.to);
      args.onProgress?.({ status: "processing", progress: 100 });
    } catch (error) {
      if (!canUseClient) {
        throw error;
      }
      console.warn("Server conversion failed, falling back to client conversion.", error);
      buffer = await convertVideo(args.buf, args.from, args.to, {
        quality: args.quality,
        onProgress: (progress) => {
          args.onProgress?.({
            status: "processing",
            progress: progress.ratio * 100,
            time: progress.time,
          });
        },
      });
    }
  } else {
    // No server fallback: the Worker can't run native FFmpeg, and the input
    // buffer has already been handed to the FFmpeg worker.
    buffer = await convertVideo(args.buf, args.from, args.to, {
      quality: args.quality,
      onProgress: (progress) => {
        args.onProgress?.({
          status: "processing",
          progress: progress.ratio * 100,
          time: progress.time,
        });
      },
    });
  }

  return { kind: "single", buffer };
}

export async function compressMediaOnMainThread(args: {
  format: string;
  buf: ArrayBuffer;
  onProgress?: (update: ProgressUpdate) => void;
  quality?: number;
}): Promise<ArrayBuffer> {
  const { compressMedia } = await import("./video");
  const buffer = await compressMedia(args.buf, args.format, {
    quality: args.quality,
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
}): Promise<ArrayBuffer> {
  const target = resolveCompressionTarget(args.format);
  if (target === "image-worker") {
    if (!args.worker) {
      throw new Error("Compression worker is required for image formats.");
    }
    if (args.format.toLowerCase() === "png") {
      return compressPngWithWorker({
        worker: args.worker,
        buf: args.buf,
        quality: args.quality,
      });
    }
    return compressImageWithWorker({
      worker: args.worker,
      format: args.format,
      buf: args.buf,
      quality: args.quality,
    });
  }
  if (target === "image-browser") {
    return compressImageInBrowserWithTelemetry({
      buf: args.buf,
      format: args.format,
      quality: args.quality,
      onProgress: args.onProgress,
    });
  }
  if (target === "image-server") {
    return compressImageViaApi({
      buf: args.buf,
      format: args.format,
      onProgress: args.onProgress,
    });
  }
  if (target === "pdf") {
    return compressPdfViaApi({ buf: args.buf, onProgress: args.onProgress });
  }
  if (target === "audio" || target === "video") {
    return compressMediaOnMainThread({
      format: args.format,
      buf: args.buf,
      onProgress: args.onProgress,
      quality: args.quality,
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

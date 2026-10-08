// Load FFmpeg.wasm for video conversion
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { normalizeBlobPart } from "../blob-parts";
import { AUDIO_FORMATS, VIDEO_FORMATS, detectCapabilities } from '../capabilities';
import { createServerActionRequestHeaders } from "../server-action-client";
import { buildConvertCommand } from "./ffmpeg-args";
import { compressWithFFmpeg } from "./ffmpeg-compress";
import type { ToolRunMetadata } from "@serp-tools/tool-telemetry";

let ffmpeg: FFmpeg | null = null;
let loaded = false;

const publicAssetBaseUrl = process.env.NEXT_PUBLIC_ASSETS_BASE_URL?.replace(/\/+$/, "") || "";

function resolvePublicAssetPath(path: `/${string}`) {
  return publicAssetBaseUrl ? `${publicAssetBaseUrl}${path}` : path;
}
const AUDIO_FORMAT_SET = new Set(AUDIO_FORMATS);
const VIDEO_FORMAT_SET = new Set(VIDEO_FORMATS);

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

export function shouldUseServerConversion(fromFormat: string, toFormat: string) {
  const serverOnly = new Set(["rm", "rmvb"]);
  if (serverOnly.has(toFormat.toLowerCase())) {
    return true;
  }
  const from = fromFormat.toLowerCase();
  const to = toFormat.toLowerCase();
  if (from === "amr" && ["mp2", "oga", "ogg"].includes(to)) {
    return true;
  }
  return !detectCapabilities().supportsVideoConversion;
}

export async function convertVideoViaApi(
  inputBuffer: ArrayBuffer,
  fromFormat: string,
  toFormat: string
): Promise<ArrayBuffer> {
  const route = "/api/video-convert";
  const baseMetadata: ToolRunMetadata = {
    route,
    from: fromFormat,
    to: toFormat,
    engine: "server-video",
  };
  let response: Response;
  try {
    response = await fetch(`${route}?from=${fromFormat}&to=${toFormat}`, {
      method: "POST",
      headers: createServerActionRequestHeaders({
        "Content-Type": "application/octet-stream",
      }),
      body: inputBuffer,
    });
  } catch {
    throw createTelemetryError(
      "network_error",
      "Server conversion request failed",
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
      "server_convert_failed",
      `Server conversion failed (${response.status})${detail}`,
      { ...baseMetadata, status: response.status }
    );
  }

  return await response.arrayBuffer();
}

async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && loaded) return ffmpeg;

  // Check capabilities before loading FFmpeg
  const capabilities = detectCapabilities();
  if (!capabilities.supportsVideoConversion) {
    throw new Error(`Video conversion not supported: ${capabilities.reason}`);
  }

  if (!ffmpeg) {
    ffmpeg = new FFmpeg();

    const useSingleThread = process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD === "true";
    const baseURL = resolvePublicAssetPath(
      useSingleThread ? "/vendor/ffmpeg-st" : "/vendor/ffmpeg"
    );
    // @ffmpeg/ffmpeg runs the core in a module worker, which can only import
    // the ESM build. It is small enough to serve from the app's own origin;
    // the 32 MB wasm stays on the asset host.
    const coreURL = useSingleThread
      ? new URL("/vendor/ffmpeg-esm/ffmpeg-core.js", self.location.href).href
      : `${baseURL}/ffmpeg-core.js`;

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    const loadConfig: {
      classWorkerURL?: string;
      coreURL: string;
      wasmURL: string;
      workerURL?: string;
    } = {
      // Served unbundled: webpack would rewrite the worker's import(coreURL).
      // Absolute, because the library resolves it against its bundled import.meta.url.
      classWorkerURL: useSingleThread
        ? new URL("/vendor/ffmpeg-esm/worker.js", self.location.href).href
        : undefined,
      coreURL,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    };

    if (!useSingleThread) {
      loadConfig.workerURL = `${baseURL}/ffmpeg-core.worker.js`;
    }

    await ffmpeg.load(loadConfig);

    loaded = true;
  }

  return ffmpeg;
}

export async function convertVideo(
  inputBuffer: ArrayBuffer,
  fromFormat: string,
  toFormat: string,
  options: {
    quality?: number;
    audioOnly?: boolean;
    onProgress?: (progress: { ratio: number; time: number }) => void;
  } = {}
): Promise<ArrayBuffer> {
  const ff = await loadFFmpeg();

  // Remove any existing listeners - ff.off requires a handler function
  // We'll just use removeAllListeners or skip this for now
  // ff.off('progress', handler);

  // Set up progress callback
  const progressHandler = options.onProgress
    ? ({ progress, time }: { progress: number; time: number }) => {
        console.log('[FFmpeg Progress]', progress, time);
        // Progress is 0-1, convert to percentage
        options.onProgress?.({
          ratio: progress || 0,
          time: time || 0,
        });
      }
    : null;

  if (progressHandler) {
    ff.on('progress', progressHandler);
  }

  const { inputName, outputName, args, prepass, scratchFiles = [] } = buildConvertCommand(
    fromFormat,
    toFormat,
  );

  // Write input file
  await ff.writeFile(inputName, new Uint8Array(inputBuffer));

  if (prepass) {
    await ff.exec(prepass);
  }

  // Log the command for debugging
  console.log('[FFmpeg Command]', args.join(' '));

  let data: Uint8Array | string;

  try {
    try {
      await ff.deleteFile(outputName);
    } catch {
      // Ignore missing output file
    }

    // Execute conversion
    const exitCode = await ff.exec(args);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg failed with exit code ${exitCode}`);
    }

    // Read output file
    data = await ff.readFile(outputName);
  } finally {
    if (progressHandler) {
      ff.off('progress', progressHandler);
    }
  }

  // Ensure we have a Uint8Array
  if (!(data instanceof Uint8Array)) {
    throw new Error('Unexpected output format from FFmpeg');
  }

  console.log(`Output file size: ${data.length} bytes`);

  // Cleanup
  try {
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);
    for (const name of scratchFiles) {
      await ff.deleteFile(name);
    }
  } catch (cleanupErr) {
    console.warn('Cleanup error:', cleanupErr);
  }

  // Copy out of FFmpeg's memory; SharedArrayBuffer only exists on isolated pages.
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

  return normalizeBlobPart(buffer);
}

export async function compressMedia(
  inputBuffer: ArrayBuffer,
  format: string,
  options: {
    quality?: number;
    onProgress?: (progress: { ratio: number; time: number }) => void;
  } = {}
): Promise<ArrayBuffer> {
  const normalized = format.toLowerCase();
  if (!AUDIO_FORMAT_SET.has(normalized) && !VIDEO_FORMAT_SET.has(normalized)) {
    throw new Error(`Compression not supported for ${format}`);
  }

  const ff = await loadFFmpeg();
  return compressWithFFmpeg(ff, inputBuffer, normalized, options);
}

export async function extractAudioForTranscription(
  inputBuffer: ArrayBuffer,
  fromFormat: string,
  options: {
    onProgress?: (progress: { ratio: number; time: number }) => void;
  } = {}
): Promise<ArrayBuffer> {
  const ff = await loadFFmpeg();

  const progressHandler = options.onProgress
    ? ({ progress, time }: { progress: number; time: number }) => {
        options.onProgress?.({
          ratio: progress || 0,
          time: time || 0,
        });
      }
    : null;

  if (progressHandler) {
    ff.on('progress', progressHandler);
  }

  const inputName = `input.${fromFormat}`;
  const outputName = "output.f32";

  await ff.writeFile(inputName, new Uint8Array(inputBuffer));

  const args = [
    "-y",
    "-nostdin",
    "-i",
    inputName,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "f32le",
    outputName,
  ];

  let data: Uint8Array | string;

  try {
    try {
      await ff.deleteFile(outputName);
    } catch {
      // Ignore missing output file
    }

    const exitCode = await ff.exec(args);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg audio extraction failed with exit code ${exitCode}`);
    }

    data = await ff.readFile(outputName);
  } finally {
    if (progressHandler) {
      ff.off('progress', progressHandler);
    }
  }

  if (!(data instanceof Uint8Array)) {
    throw new Error("Unexpected output format from FFmpeg audio extraction");
  }

  try {
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);
  } catch (cleanupErr) {
    console.warn("Cleanup error:", cleanupErr);
  }

  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

  return normalizeBlobPart(buffer);
}

export async function cleanupFFmpeg() {
  if (ffmpeg) {
    ffmpeg.terminate();
    ffmpeg = null;
    loaded = false;
  }
}

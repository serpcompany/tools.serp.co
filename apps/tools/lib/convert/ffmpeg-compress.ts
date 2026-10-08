// Compresses one audio or video file with a loaded FFmpeg.wasm instance.
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { normalizeBlobPart } from "../blob-parts.ts";
import { buildCompressionCommand } from "./ffmpeg-args.ts";

type FFmpegInstance = Pick<FFmpeg, "writeFile" | "readFile" | "deleteFile" | "exec" | "on" | "off">;

export async function compressWithFFmpeg(
  ff: FFmpegInstance,
  inputBuffer: ArrayBuffer,
  format: string,
  options: {
    quality?: number;
    onProgress?: (progress: { ratio: number; time: number }) => void;
  } = {}
): Promise<ArrayBuffer> {
  const progressHandler = options.onProgress
    ? ({ progress, time }: { progress: number; time: number }) => {
        options.onProgress?.({
          ratio: progress || 0,
          time: time || 0,
        });
      }
    : null;

  if (progressHandler) {
    ff.on("progress", progressHandler);
  }

  const { inputName, outputName, args } = buildCompressionCommand(format, options.quality);
  // writeFile transfers the buffer to FFmpeg's worker, which detaches
  // inputBuffer (its byteLength becomes 0): measure it first, and read the
  // original back from FFmpeg's file system if it has to be returned.
  const inputBytes = inputBuffer.byteLength;
  await ff.writeFile(inputName, new Uint8Array(inputBuffer));

  let data: Uint8Array | string;
  try {
    try {
      await ff.deleteFile(outputName);
    } catch {
      // Ignore missing output file
    }
    const exitCode = await ff.exec(args);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg failed with exit code ${exitCode}`);
    }
    data = await ff.readFile(outputName);
  } finally {
    if (progressHandler) {
      ff.off("progress", progressHandler);
    }
  }

  // Keep the original when compressing didn't make the file smaller.
  const result = data instanceof Uint8Array && data.byteLength >= inputBytes
    ? await ff.readFile(inputName)
    : data;
  if (!(result instanceof Uint8Array)) {
    throw new Error("Unexpected output format from FFmpeg");
  }

  try {
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);
  } catch (cleanupErr) {
    console.warn("Cleanup error:", cleanupErr);
  }

  const buffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  return normalizeBlobPart(buffer);
}

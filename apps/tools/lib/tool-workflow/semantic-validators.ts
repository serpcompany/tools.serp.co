import decodeJpeg from "@jsquash/jpeg/decode.js";
import { createFile, type MP4BoxBuffer, type Movie } from "mp4box";
import { parseBuffer } from "music-metadata";
import Papa from "papaparse";
import UPNGModule from "upng-js";

import type { SemanticVerification, WorkflowMedia } from "./index.ts";

const expectedMimeTypes: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "3gp": ["audio/3gpp", "video/3gpp", "application/octet-stream"],
    csv: ["text/csv"],
    jpg: ["image/jpeg"],
    m4a: ["audio/mp4", "application/octet-stream"],
    m4v: ["video/mp4", "video/x-m4v", "application/octet-stream"],
    mov: ["video/quicktime", "application/octet-stream"],
    mp3: ["audio/mpeg", "application/octet-stream"],
    mp4: ["video/mp4", "application/octet-stream"],
    png: ["image/png"],
    txt: ["text/plain"],
    webm: ["audio/webm", "video/webm", "application/octet-stream"],
  });

const UPNG = UPNGModule as {
  decode(bytes: ArrayBuffer): { width: number; height: number };
  toRGBA8(image: { width: number; height: number }): ArrayBuffer[];
};

const MAX_DECODED_RGBA_BYTES = 64 * 1_024 * 1_024;
const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_SEMANTIC_MEDIA_BYTES = 64 * 1_024 * 1_024;

type DecodedImage = Readonly<{
  data: Uint8Array | Uint8ClampedArray;
  format: "jpeg";
  width: number;
  height: number;
}>;

export type SemanticDecoderAdapters = Readonly<{
  decodeJpeg(bytes: Uint8Array): Promise<DecodedImage>;
}>;

export type SemanticVerificationContext = Readonly<{
  maxBytes?: number;
  requiredMediaTrack?: "any" | "audio";
  signal?: AbortSignal;
}>;

const defaultDecoderAdapters: SemanticDecoderAdapters = Object.freeze({
  async decodeJpeg(bytes) {
    return {
      ...(await decodeJpeg(Uint8Array.from(bytes).buffer)),
      format: "jpeg",
    };
  },
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodedAllocationExceeds(
  width: number,
  height: number,
  frames = 1,
): boolean {
  return (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(frames) ||
    width < 1 ||
    height < 1 ||
    frames < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width > Math.floor(MAX_DECODED_RGBA_BYTES / 4 / height / frames)
  );
}

function pngStructureError(bytes: Uint8Array): string | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) {
    return "Invalid PNG signature";
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = signature.length;
  let chunkCount = 0;
  let sawImageData = false;
  let width = 0;
  let height = 0;
  let declaredFrameCount: number | undefined;
  let frameControlCount = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) {
      return "PNG chunk is truncated";
    }
    const length = view.getUint32(offset, false);
    const type = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    if (length > bytes.byteLength - offset - 12) {
      return `PNG ${type} chunk exceeds the input`;
    }
    if (chunkCount === 0 && (type !== "IHDR" || length !== 13)) {
      return "PNG must begin with a 13-byte IHDR chunk";
    }
    const storedCrc = view.getUint32(offset + 8 + length, false);
    const computedCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (storedCrc !== computedCrc) {
      return `PNG ${type} chunk has an invalid CRC`;
    }
    if (type === "IHDR") {
      width = view.getUint32(offset + 8, false);
      height = view.getUint32(offset + 12, false);
      if (width === 0 || height === 0) {
        return "PNG dimensions must be non-zero";
      }
      if (decodedAllocationExceeds(width, height)) {
        return "PNG decoded RGBA size exceeds the semantic verification limit";
      }
    }
    if (type === "acTL") {
      if (length !== 8) return "PNG acTL chunk has an invalid length";
      declaredFrameCount = view.getUint32(offset + 8, false);
      if (declaredFrameCount === 0) {
        return "PNG animation must declare at least one frame";
      }
      if (decodedAllocationExceeds(width, height, declaredFrameCount)) {
        return "PNG aggregate decoded RGBA size exceeds the semantic verification limit";
      }
    }
    if (type === "fcTL") {
      if (length !== 26) return "PNG fcTL chunk has an invalid length";
      frameControlCount += 1;
      const preflightFrames = Math.max(
        declaredFrameCount ?? 1,
        frameControlCount,
      );
      if (decodedAllocationExceeds(width, height, preflightFrames)) {
        return "PNG aggregate decoded RGBA size exceeds the semantic verification limit";
      }
    }
    if (type === "IDAT") {
      sawImageData = true;
    }
    const nextOffset = offset + 12 + length;
    if (type === "IEND") {
      if (length !== 0 || !sawImageData || nextOffset !== bytes.byteLength) {
        return "PNG IEND chunk is invalid or not terminal";
      }
      try {
        const source = Uint8Array.from(bytes).buffer;
        const decoded = UPNG.decode(source);
        const frames = UPNG.toRGBA8(decoded);
        if (
          decoded.width !== width ||
          decoded.height !== height ||
          frames.length === 0 ||
          decodedAllocationExceeds(width, height, frames.length) ||
          frames.some((frame) => frame.byteLength !== width * height * 4)
        ) {
          return "PNG decoder produced inconsistent image data";
        }
        return undefined;
      } catch {
        return "PNG decoder rejected the image data";
      }
    }
    offset = nextOffset;
    chunkCount += 1;
  }
  return "PNG is missing its IEND chunk";
}

function jpegAllocationError(bytes: Uint8Array): string | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset < bytes.byteLength) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.byteLength) break;
    const length = view.getUint16(offset, false);
    if (length < 2 || offset + length > bytes.byteLength) break;
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame && length >= 8) {
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      return decodedAllocationExceeds(width, height)
        ? "JPEG decoded RGBA size exceeds the semantic verification limit"
        : undefined;
    }
    offset += length;
  }
  return undefined;
}

async function jpegSemanticError(
  bytes: Uint8Array,
  decoder: SemanticDecoderAdapters["decodeJpeg"],
): Promise<string | undefined> {
  const allocationError = jpegAllocationError(bytes);
  if (allocationError) return allocationError;
  try {
    const decoded = await decoder(bytes);
    if (
      !Number.isSafeInteger(decoded.width) ||
      !Number.isSafeInteger(decoded.height) ||
      decoded.width < 1 ||
      decoded.height < 1 ||
      decoded.format !== "jpeg" ||
      decoded.width > Math.floor(Number.MAX_SAFE_INTEGER / 4 / decoded.height) ||
      decoded.data.byteLength !== decoded.width * decoded.height * 4
    ) {
      return "JPEG decoder produced inconsistent image data";
    }
    return undefined;
  } catch {
    return "JPEG decoder rejected the image data";
  }
}

function boundedParseLimit(
  context: SemanticVerificationContext,
  maximum: number,
): number {
  const declaredLimit =
    context.maxBytes === undefined
      ? maximum
      : Number.isSafeInteger(context.maxBytes) && context.maxBytes >= 0
        ? context.maxBytes
        : 0;
  return Math.min(maximum, declaredLimit);
}

async function musicMetadataSemanticError(
  bytes: Uint8Array,
  format: "mp3" | "webm",
  context: SemanticVerificationContext,
): Promise<string | undefined> {
  if (bytes.byteLength > boundedParseLimit(context, MAX_SEMANTIC_MEDIA_BYTES)) {
    return `${format.toUpperCase()} exceeds the semantic parser input limit`;
  }
  context.signal?.throwIfAborted();
  try {
    // music-metadata's browser entry parses the bounded in-memory bytes and
    // determines the container from their structure, independent of endpoint
    // filename and MIME metadata.
    const metadata = await parseBuffer(bytes, undefined, {
      duration: true,
      skipCovers: true,
    });
    context.signal?.throwIfAborted();
    const { container, codec, duration, hasAudio, hasVideo, trackInfo } =
      metadata.format;
    const hasDuration = Number.isFinite(duration) && (duration ?? 0) > 0;
    const hasUsableWebmAudio = trackInfo.some(
      (track) =>
        track.type === 2 &&
        Boolean(track.codecName) &&
        (track.audio?.channels ?? 0) > 0 &&
        (track.audio?.samplingFrequency ?? 0) > 0,
    );
    const matchesContainer =
      format === "mp3"
        ? container?.startsWith("MPEG") && /Layer 3/i.test(codec ?? "")
        : container === "EBML/webm";
    const meetsTrackRequirement =
      format === "mp3"
        ? hasAudio === true
        : context.requiredMediaTrack === "audio"
          ? hasAudio === true && hasUsableWebmAudio
          : hasAudio === true || hasVideo === true;
    return matchesContainer && hasDuration && meetsTrackRequirement
      ? undefined
      : `${format.toUpperCase()} parser found no usable timed ${context.requiredMediaTrack === "audio" ? "audio" : "media"} track`;
  } catch {
    context.signal?.throwIfAborted();
    return `${format.toUpperCase()} parser rejected the file`;
  }
}

function bmffSemanticError(
  bytes: Uint8Array,
  format: string,
  context: SemanticVerificationContext,
): string | undefined {
  const parseLimit = boundedParseLimit(context, MAX_SEMANTIC_MEDIA_BYTES);
  if (bytes.byteLength > parseLimit) {
    return "MP4 exceeds the semantic parser input limit";
  }
  context.signal?.throwIfAborted();
  try {
    const file = createFile();
    let info: Movie | undefined;
    let parserError: string | undefined;
    file.onReady = (movie) => {
      info = movie;
    };
    file.onError = (_module, message) => {
      parserError = message;
    };
    // MP4Box is synchronous. The signal is checked on both sides of its call,
    // but JavaScript cannot interrupt it mid-parse. A full-buffer view is reused
    // to avoid the former unconditional 256 MiB-sized copy.
    const buffer = (bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer
      : bytes.slice().buffer) as MP4BoxBuffer;
    buffer.fileStart = 0;
    file.appendBuffer(buffer, true);
    file.flush();
    context.signal?.throwIfAborted();
    if (parserError) return `MP4 parser rejected the file: ${parserError}`;
    if (!info?.hasMoov || info.tracks.length === 0) {
      return "MP4 parser found no complete timed media tracks";
    }
    const majorBrand = info.brands[0]?.trim().toLowerCase() ?? "";
    const reservedMajorBrand =
      majorBrand === "qt" ||
      majorBrand === "m4a" ||
      majorBrand.startsWith("3gp");
    const formatMatchesContainer =
      format === "mov"
        ? majorBrand === "qt"
        : format === "3gp"
          ? majorBrand.startsWith("3gp")
          : format === "m4a"
            ? majorBrand === "m4a" && info.videoTracks.length === 0
            : format === "m4v"
              ? !reservedMajorBrand && info.videoTracks.length > 0
              : format === "mp4" && !reservedMajorBrand;
    if (!formatMatchesContainer) {
      return `MP4 parser found bytes for a different ISO media format than ${format}`;
    }
    const timedTrackIds = new Set(
      (context.requiredMediaTrack === "audio"
        ? info.audioTracks
        : [...info.audioTracks, ...info.videoTracks]
      ).map((track) => track.id),
    );
    if (timedTrackIds.size === 0) {
      return "MP4 parser found no complete timed media tracks";
    }
    const mediaRanges = file.mdats.flatMap((mdat) => {
      const start = mdat.start;
      const headerSize = mdat.hdr_size;
      return Number.isSafeInteger(start) &&
        Number.isSafeInteger(headerSize) &&
        Number.isSafeInteger(mdat.size) &&
        start !== undefined &&
        headerSize !== undefined &&
        start >= 0 &&
        headerSize >= 8 &&
        mdat.size >= headerSize &&
        start <= Number.MAX_SAFE_INTEGER - mdat.size &&
        start + mdat.size <= bytes.byteLength
        ? [{ start: start + headerSize, end: start + mdat.size }]
        : [];
    });
    const hasCompleteTimedSamples = info.tracks
      .filter((track) => timedTrackIds.has(track.id))
      .every((track) => {
        const samples = file.getTrackSamplesInfo(track.id);
        return (
          Boolean(track.codec) &&
          samples.length > 0 &&
          samples.length === track.nb_samples &&
          samples.every(
            (sample) =>
              Number.isSafeInteger(sample.offset) &&
              Number.isSafeInteger(sample.size) &&
              Number.isSafeInteger(sample.duration) &&
              Number.isSafeInteger(sample.timescale) &&
              sample.offset >= 0 &&
              sample.size > 0 &&
              sample.duration > 0 &&
              sample.timescale > 0 &&
              sample.offset <= Number.MAX_SAFE_INTEGER - sample.size &&
              mediaRanges.some(
                (range) =>
                  sample.offset >= range.start &&
                  sample.offset + sample.size <= range.end,
              ),
          )
        );
      });
    if (!hasCompleteTimedSamples) {
      return "MP4 parser found no complete timed media tracks";
    }
    return undefined;
  } catch {
    context.signal?.throwIfAborted();
    return "MP4 parser rejected the file";
  }
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function textStructureError(bytes: Uint8Array): string | undefined {
  const text = decodeUtf8(bytes);
  if (text === undefined) return "Text is not valid UTF-8";
  return text.trim() ? undefined : "Text is empty";
}

function csvStructureError(bytes: Uint8Array): string | undefined {
  const textError = textStructureError(bytes);
  if (textError) return textError;
  const text = decodeUtf8(bytes)!;
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const fatalError = parsed.errors.find(
    ({ code }) => code !== "UndetectableDelimiter",
  );
  if (fatalError) {
    return fatalError.message || "CSV parser rejected the result";
  }
  if (parsed.data.length < 2) return "CSV needs a header and a data row";
  const headers = parsed.data[0] ?? [];
  if (!headers.length || headers.some((header) => !header.trim())) {
    return "CSV headers must be non-empty";
  }
  if (new Set(headers).size !== headers.length) {
    return "CSV headers must be unique";
  }
  if (parsed.data.slice(1).some((row) => row.length !== headers.length)) {
    return "CSV rows must match the header cardinality";
  }
  return undefined;
}

export async function verifyMediaSemantics(
  media: WorkflowMedia,
  adapters: SemanticDecoderAdapters = defaultDecoderAdapters,
  context: SemanticVerificationContext = {},
): Promise<SemanticVerification> {
  if (media.bytes.byteLength === 0) {
    return { status: "rejected", message: `${media.format} result is empty` };
  }
  const expectedMimeType = expectedMimeTypes[media.format];
  if (!expectedMimeType) {
    return {
      status: "unavailable",
      message: `No semantic verifier for ${media.format}`,
    };
  }
  if (!expectedMimeType.includes(media.mimeType)) {
    return {
      status: "rejected",
      message: `Expected MIME ${expectedMimeType.join(" or ")}, received ${media.mimeType}`,
    };
  }
  const error =
    media.format === "png"
      ? pngStructureError(media.bytes)
      : media.format === "jpg"
        ? await jpegSemanticError(media.bytes, adapters.decodeJpeg)
        : media.format === "mp3" || media.format === "webm"
          ? await musicMetadataSemanticError(media.bytes, media.format, context)
          : ["3gp", "m4a", "m4v", "mov", "mp4"].includes(media.format)
            ? bmffSemanticError(media.bytes, media.format, context)
            : media.format === "csv"
              ? csvStructureError(media.bytes)
              : textStructureError(media.bytes);
  return error
    ? { status: "rejected", message: error }
    : { status: "verified" };
}

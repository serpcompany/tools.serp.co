import decodeJpeg from "@jsquash/jpeg/decode.js";
import { createFile, type MP4BoxBuffer, type Movie } from "mp4box";
import Papa from "papaparse";
import UPNGModule from "upng-js";

import type { SemanticVerification, WorkflowMedia } from "./index.ts";

const expectedMimeTypes: Readonly<Record<string, string>> = Object.freeze({
  csv: "text/csv",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  png: "image/png",
  txt: "text/plain",
});

const UPNG = UPNGModule as {
  decode(bytes: ArrayBuffer): { width: number; height: number };
  toRGBA8(image: { width: number; height: number }): ArrayBuffer[];
};

const MAX_DECODED_RGBA_BYTES = 64 * 1_024 * 1_024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_MP4_PARSE_BYTES = 256 * 1_024 * 1_024;

type DecodedImage = Readonly<{
  data: Uint8Array | Uint8ClampedArray;
  format: "jpeg";
  width: number;
  height: number;
}>;

export type SemanticDecoderAdapters = Readonly<{
  decodeJpeg(bytes: Uint8Array): Promise<DecodedImage>;
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
      if (
        width > MAX_IMAGE_DIMENSION ||
        height > MAX_IMAGE_DIMENSION ||
        width > Math.floor(MAX_DECODED_RGBA_BYTES / 4 / height)
      ) {
        return "PNG decoded RGBA size exceeds the semantic verification limit";
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

async function jpegSemanticError(
  bytes: Uint8Array,
  decoder: SemanticDecoderAdapters["decodeJpeg"],
): Promise<string | undefined> {
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

function bmffSemanticError(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength > MAX_MP4_PARSE_BYTES) {
    return "MP4 exceeds the semantic parser input limit";
  }
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
    const buffer = Uint8Array.from(bytes).buffer as MP4BoxBuffer;
    buffer.fileStart = 0;
    file.appendBuffer(buffer, true);
    file.flush();
    if (parserError) return `MP4 parser rejected the file: ${parserError}`;
    if (
      !info?.hasMoov ||
      info.duration <= 0 ||
      info.timescale <= 0 ||
      info.tracks.length === 0 ||
      info.audioTracks.length + info.videoTracks.length === 0 ||
      !info.tracks.every(
        (track) =>
          track.duration > 0 &&
          track.timescale > 0 &&
          track.nb_samples > 0 &&
          Boolean(track.codec),
      )
    ) {
      return "MP4 parser found no complete timed media tracks";
    }
    return undefined;
  } catch {
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
  if (media.mimeType !== expectedMimeType) {
    return {
      status: "rejected",
      message: `Expected MIME ${expectedMimeType}, received ${media.mimeType}`,
    };
  }
  const error =
    media.format === "png"
      ? pngStructureError(media.bytes)
      : media.format === "jpg"
        ? await jpegSemanticError(media.bytes, adapters.decodeJpeg)
        : media.format === "mp4"
          ? bmffSemanticError(media.bytes)
          : media.format === "csv"
            ? csvStructureError(media.bytes)
            : textStructureError(media.bytes);
  return error
    ? { status: "rejected", message: error }
    : { status: "verified" };
}

import Papa from "papaparse";

import type { SemanticVerification, WorkflowMedia } from "./index.ts";

const expectedMimeTypes: Readonly<Record<string, string>> = Object.freeze({
  csv: "text/csv",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  png: "image/png",
  txt: "text/plain",
});

function pngStructureError(bytes: Uint8Array): string | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) {
    return "Invalid PNG signature";
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = signature.length;
  let chunkCount = 0;
  let sawImageData = false;
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
    if (type === "IDAT") {
      sawImageData = true;
    }
    const nextOffset = offset + 12 + length;
    if (type === "IEND") {
      return length === 0 && sawImageData && nextOffset === bytes.byteLength
        ? undefined
        : "PNG IEND chunk is invalid or not terminal";
    }
    offset = nextOffset;
    chunkCount += 1;
  }
  return "PNG is missing its IEND chunk";
}

function jpegStructureError(bytes: Uint8Array): string | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return "JPEG is missing its SOI marker";
  }
  let offset = 2;
  let sawFrame = false;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      return "JPEG segment does not begin with a marker";
    }
    while (bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined) {
      return "JPEG marker is truncated";
    }
    if (marker === 0xd9) {
      return sawFrame && offset === bytes.byteLength
        ? undefined
        : "JPEG EOI marker is invalid or not terminal";
    }
    if (offset + 2 > bytes.byteLength) {
      return "JPEG segment length is truncated";
    }
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || length > bytes.byteLength - offset) {
      return "JPEG segment exceeds the input";
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      sawFrame = true;
    }
    offset += length;
    if (marker !== 0xda) {
      continue;
    }
    if (!sawFrame) {
      return "JPEG scan appears before a frame header";
    }
    while (offset < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const next = bytes[offset + 1];
      if (
        next === 0x00 ||
        (next !== undefined && next >= 0xd0 && next <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      if (next === 0xd9) {
        return offset + 2 === bytes.byteLength
          ? undefined
          : "JPEG EOI marker is not terminal";
      }
      return "JPEG scan contains an invalid marker";
    }
    return "JPEG scan is missing its EOI marker";
  }
  return "JPEG is missing its EOI marker";
}

function bmffStructureError(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const requiredPayloadSizes = new Map([
    ["ftyp", 8],
    ["mdat", 1],
    ["moov", 1],
  ]);
  const found = new Set<string>();
  let offset = 0;

  while (offset < bytes.byteLength) {
    const remaining = bytes.byteLength - offset;
    if (remaining < 8) {
      return "MP4 top-level box header is truncated";
    }
    const size32 = view.getUint32(offset, false);
    const type = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    let headerSize = 8;
    let boxSize: number;
    if (size32 === 1) {
      if (remaining < 16) {
        return `MP4 ${type} extended-size header is truncated`;
      }
      const extendedSize = view.getBigUint64(offset + 8, false);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        return `MP4 ${type} box size is not safely representable`;
      }
      headerSize = 16;
      boxSize = Number(extendedSize);
    } else {
      boxSize = size32 === 0 ? remaining : size32;
    }
    if (boxSize < headerSize) {
      return `MP4 ${type} box is smaller than its header`;
    }
    if (boxSize > remaining) {
      return `MP4 ${type} box exceeds the input`;
    }
    const requiredPayloadSize = requiredPayloadSizes.get(type);
    if (requiredPayloadSize !== undefined) {
      if (boxSize - headerSize < requiredPayloadSize) {
        return `MP4 ${type} box has no valid payload`;
      }
      found.add(type);
    }
    offset += boxSize;
  }
  for (const type of requiredPayloadSizes.keys()) {
    if (!found.has(type)) {
      return `MP4 is missing its ${type} box`;
    }
  }
  return undefined;
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
  if (parsed.errors.length) {
    return parsed.errors[0]?.message ?? "CSV parser rejected the result";
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

export function verifyMediaSemantics(
  media: WorkflowMedia,
): SemanticVerification {
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
        ? jpegStructureError(media.bytes)
        : media.format === "mp4"
          ? bmffStructureError(media.bytes)
          : media.format === "csv"
            ? csvStructureError(media.bytes)
            : textStructureError(media.bytes);
  return error
    ? { status: "rejected", message: error }
    : { status: "verified" };
}

// HTTP header values are byte strings. Browsers read each byte as Latin-1, so a
// raw UTF-8 filename such as "Fr-café.ogg" arrives as "Fr-cafÃ©.ogg", and
// Node's Headers rejects anything above U+00FF outright. The media-fetch route
// therefore sends the name twice: an ASCII-only fallback in x-media-filename
// and the full UTF-8 name percent-encoded (RFC 5987 style) in
// x-media-filename-encoded. Clients prefer the encoded header.

export const MEDIA_FILENAME_HEADER = "x-media-filename";
export const MEDIA_FILENAME_ENCODED_HEADER = "x-media-filename-encoded";

const MAX_MEDIA_FILENAME_CODE_POINTS = 180;

function truncateMediaFilename(fileName: string): string {
  const codePoints = Array.from(fileName);
  if (codePoints.length <= MAX_MEDIA_FILENAME_CODE_POINTS) return fileName;

  const extension = fileName.match(/\.[a-z0-9]{1,16}$/iu)?.[0] ?? "";
  const extensionPoints = Array.from(extension);
  return [
    ...codePoints.slice(0, MAX_MEDIA_FILENAME_CODE_POINTS - extensionPoints.length),
    ...extensionPoints,
  ].join("");
}

export function sanitizeMediaFilename(fileName: string): string {
  const safe = Array.from(fileName, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return "";
    }
    return character === "/" || character === "\\" ? "-" : character;
  })
    .join("")
    .trim();

  return truncateMediaFilename(safe || "download");
}

function toAsciiFallback(fileName: string): string {
  return Array.from(fileName, (character) =>
    (character.codePointAt(0) ?? 0) <= 0x7e ? character : "-",
  ).join("");
}

// RFC 5987 attr-char excludes a few characters encodeURIComponent leaves alone.
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function setMediaFilenameHeaders(headers: Headers, fileName: string): void {
  const safeFileName = sanitizeMediaFilename(fileName);
  headers.set(MEDIA_FILENAME_HEADER, toAsciiFallback(safeFileName));
  headers.set(MEDIA_FILENAME_ENCODED_HEADER, encodeRfc5987(safeFileName));
}

export function readMediaFilename(headers: Pick<Headers, "get">): string {
  const encoded = headers.get(MEDIA_FILENAME_ENCODED_HEADER)?.trim();
  if (encoded) {
    try {
      return sanitizeMediaFilename(decodeURIComponent(encoded));
    } catch {
      // Malformed percent-encoding: fall back to the ASCII header.
    }
  }

  const fallback = headers.get(MEDIA_FILENAME_HEADER)?.trim();
  return fallback ? sanitizeMediaFilename(fallback) : "";
}

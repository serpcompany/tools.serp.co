const PREFERRED_MEDIA_FILENAME_HEADER = 'x-media-filename-encoded';
const FALLBACK_MEDIA_FILENAME_HEADER = 'x-media-filename';
const MAX_MEDIA_FILENAME_CODE_POINTS = 180;

function truncateMediaFilename(fileName: string): string {
  const codePoints = Array.from(fileName);
  if (codePoints.length <= MAX_MEDIA_FILENAME_CODE_POINTS) return fileName;

  const extension = fileName.match(/\.[a-z0-9]{1,16}$/iu)?.[0] ?? '';
  const extensionPoints = Array.from(extension);
  return [
    ...codePoints.slice(
      0,
      MAX_MEDIA_FILENAME_CODE_POINTS - extensionPoints.length,
    ),
    ...extensionPoints,
  ].join('');
}

function sanitizeMediaFilename(fileName: string): string {
  const safe = Array.from(fileName, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return '';
    }
    return character === '/' || character === '\\' ? '-' : character;
  })
    .join('')
    .trim();

  return truncateMediaFilename(safe || 'download');
}

function toAsciiFallback(fileName: string): string {
  return Array.from(fileName, (character) =>
    (character.codePointAt(0) ?? 0) <= 0x7e ? character : '-',
  ).join('');
}

export function setMediaFilenameHeaders(
  headers: Headers,
  fileName: string,
): void {
  const safeFileName = sanitizeMediaFilename(fileName);
  headers.set(FALLBACK_MEDIA_FILENAME_HEADER, toAsciiFallback(safeFileName));
  headers.set(
    PREFERRED_MEDIA_FILENAME_HEADER,
    encodeURIComponent(safeFileName),
  );
}

export function readMediaFilename(
  headers: Pick<Headers, 'get'>,
): string | undefined {
  const encoded = headers.get(PREFERRED_MEDIA_FILENAME_HEADER);
  if (!encoded) {
    const fallback = headers.get(FALLBACK_MEDIA_FILENAME_HEADER);
    return fallback ? sanitizeMediaFilename(fallback) : undefined;
  }

  try {
    return sanitizeMediaFilename(decodeURIComponent(encoded));
  } catch {
    const fallback = headers.get(FALLBACK_MEDIA_FILENAME_HEADER);
    return fallback ? sanitizeMediaFilename(fallback) : undefined;
  }
}

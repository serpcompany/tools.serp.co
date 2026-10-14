// Marks on a decoder's errors, for BIN to JPG, JPEG and PNG to tell a
// visitor what went wrong (workerClient.ts):
// - a decode failure: the file's picture can't be decoded, because its bytes
//   are damaged, cut short, or not the format they start like, or (too
//   large) its header declares a picture larger than the engine can hold;
// - the browser has no decoder for the format at all (decode.ts).
// Any other error (an engine that didn't load, crashed or ran out of memory)
// has no mark.

const DECODE_FAILURE = "ImageDecodeError";
const TOO_LARGE = "ImageTooLargeError";
const NO_BROWSER_DECODER = "NoBrowserDecoderError";

function marked(name: string, message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = name;
  return error;
}

export function decodeFailure(message: string, cause?: unknown): Error {
  return marked(DECODE_FAILURE, message, cause);
}

// A decode failure whose file declares a picture too large to convert here:
// damaged, or really that large.
export function tooLargeFailure(message: string, cause?: unknown): Error {
  return marked(TOO_LARGE, message, cause);
}

// The error, or the first error it was caused by, with one of `names`.
function findMark(error: unknown, names: readonly string[]): Error | null {
  for (let current = error, depth = 0; current instanceof Error && depth < 8; current = current.cause, depth += 1) {
    if (names.includes(current.name)) return current;
  }
  return null;
}

// Whether `error`, or an error it was caused by, is a decode failure.
export function isDecodeFailure(error: unknown): boolean {
  return findMark(error, [DECODE_FAILURE, TOO_LARGE]) !== null;
}

export function isTooLargeFailure(error: unknown): boolean {
  return findMark(error, [TOO_LARGE]) !== null;
}

// Formats whose name, as a visitor knows it, isn't their extension in capitals.
const FORMAT_NAMES: Readonly<Record<string, string>> = { jpg: "JPEG", jpeg: "JPEG", webp: "WebP" };

export function noBrowserDecoderMessage(format: string): string {
  const name = FORMAT_NAMES[format] ?? format.toUpperCase();
  return `This browser can't open ${name} files; try a current Chrome, Edge, Firefox or Safari.`;
}

// The browser can't decode `format` at all, not even a sample of it.
export function noBrowserDecoder(format: string): Error & { format: string } {
  return Object.assign(marked(NO_BROWSER_DECODER, noBrowserDecoderMessage(format)), { format });
}

// The format the browser can't decode, when `error` or an error it was
// caused by says so; otherwise null.
export function noBrowserDecoderFormat(error: unknown): string | null {
  const mark = findMark(error, [NO_BROWSER_DECODER]) as (Error & { format?: string }) | null;
  return mark?.format ?? null;
}

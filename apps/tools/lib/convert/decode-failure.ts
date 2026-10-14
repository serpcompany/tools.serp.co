// A decoder's error that says the file's picture can't be decoded: its
// bytes are damaged, cut short, or not the format they start like. Any other
// error (an engine that didn't load, ran out of memory, or can't handle a
// variant of the format) isn't one. BIN to JPG, JPEG and PNG tell a visitor
// their file is damaged only for this (workerClient.ts).

const DECODE_FAILURE = "ImageDecodeError";

export function decodeFailure(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = DECODE_FAILURE;
  return error;
}

// Whether `error`, or an error it was caused by, is a decode failure.
export function isDecodeFailure(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 8; current = current.cause, depth += 1) {
    if (current.name === DECODE_FAILURE) return true;
  }
  return false;
}

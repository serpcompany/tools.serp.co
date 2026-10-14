// BIN to JPG, JPEG and PNG (#261, #267). A .bin name says only "binary
// data"; the files people bring to these pages are mostly pictures saved
// under it: Outlook's ATT00001.bin attachments, a browser download saved as
// .bin. The picture's first bytes say its format (image-signature.ts), and
// workerClient.ts converts it as that format. Any other file is refused
// plainly, from its first bytes alone: firmware, disc images and other
// binary files hold no picture.

import { IMAGE_SIGNATURE_BYTES, imageFormatFromBytes } from "./image-signature.ts";

const LABELS: Record<string, string> = { jpg: "JPEG", tiff: "TIFF", heic: "HEIC", ico: "ICO" };

function label(format: string): string {
  return LABELS[format] ?? format.toUpperCase();
}

// The image format a .bin file's first bytes say it holds, or null.
export function binImageFormat(bytes: Uint8Array): string | null {
  return imageFormatFromBytes(bytes.subarray(0, IMAGE_SIGNATURE_BYTES));
}

// How much of a chosen file binImageFormat needs, so a disc image of several
// gigabytes is refused without being read whole.
export const BIN_HEAD_BYTES = IMAGE_SIGNATURE_BYTES;

export function notAnImageMessage(to: string): string {
  return (
    `This file isn't an image, so it can't become a ${to.toUpperCase()}. Only pictures saved with a .bin name ` +
    "convert, such as Outlook's ATT00001.bin attachments; firmware, disc images and other binary files can't."
  );
}

// `format`: what the file's first bytes say it is.
export function unreadableImageMessage(format: string): string {
  return `This file starts like a ${label(format)} image, but the picture in it couldn't be read: it may be damaged or incomplete.`;
}

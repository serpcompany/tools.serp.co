// BIN to JPG, JPEG and PNG (#261, #267). A .bin name says only "binary
// data"; the files people bring to these pages are mostly pictures saved
// under it: Outlook's ATT00001.bin attachments, a browser download saved as
// .bin, a Mac file in MacBinary (whose own extension is .bin). The picture's
// first bytes say its format (image-signature.ts), and workerClient.ts
// converts it as that format. Any other file is refused plainly, from its
// first bytes alone: firmware, disc images and other binary files hold no
// picture.

import { IMAGE_SIGNATURE_BYTES, imageFormatFromBytes } from "./image-signature.ts";

// Each format imageFormatFromBytes names, as a visitor says it: with "an"
// before a name said from a vowel sound: AVIF, ICO, EXR, HDR ("aitch"), XCF
// ("ex"), SVG ("ess"). Camera RAW names say the camera maker.
export const IMAGE_NAMES: Readonly<Record<string, string>> = {
  jpg: "a JPEG",
  png: "a PNG",
  gif: "a GIF",
  webp: "a WebP",
  avif: "an AVIF",
  heic: "a HEIC",
  bmp: "a BMP",
  tiff: "a TIFF",
  ico: "an ICO",
  cur: "a CUR",
  svg: "an SVG",
  psd: "a PSD",
  jxl: "a JPEG XL",
  jp2: "a JPEG 2000",
  exr: "an EXR",
  hdr: "an HDR",
  xcf: "an XCF",
  dds: "a DDS",
  icns: "an ICNS",
  ktx: "a KTX",
  ktx2: "a KTX2",
  pbm: "a PBM",
  pgm: "a PGM",
  ppm: "a PPM",
  pam: "a PAM",
  pcx: "a PCX",
  xpm: "an XPM",
  wpg: "a WPG",
  sfw: "an SFW",
  pcd: "a Photo CD",
  tga: "a TGA",
  mac: "a MacPaint",
  dng: "a DNG",
  nef: "a Nikon NEF",
  arw: "a Sony ARW",
  cr2: "a Canon CR2",
  cr3: "a Canon CR3",
  crw: "a Canon CRW",
  orf: "an Olympus ORF",
  rw2: "a Panasonic RW2",
  raf: "a Fujifilm RAF",
};

function imageName(format: string): string {
  return IMAGE_NAMES[format] ?? `a ${format.toUpperCase()}`;
}

// The picture in a .bin file: its format, and where its bytes start and end.
export type BinPicture = { format: string; start: number; end: number };

const MACBINARY_HEADER = 128;

// MacBinary (I, II or III) keeps a Mac file's name, type and two forks in
// one: a 128-byte header (version 0, a name of 1 to 63 bytes, zeros at 74
// and 82, the data fork's length at 83), then the data fork, which holds the
// picture. A MacPaint picture says so by its type, PNTG; it has no signature
// of its own.
function macBinaryPicture(head: Uint8Array, size: number): BinPicture | null {
  if (head.length < MACBINARY_HEADER + 4 || head[0] !== 0 || head[74] !== 0 || head[82] !== 0) return null;
  if (head[1]! < 1 || head[1]! > 63) return null;
  const length = ((head[83]! << 24) | (head[84]! << 16) | (head[85]! << 8) | head[86]!) >>> 0;
  if (length === 0) return null;
  const end = Math.min(MACBINARY_HEADER + length, size);
  const data = head.subarray(MACBINARY_HEADER);
  const type = String.fromCharCode(...head.subarray(65, 69));
  const format = type === "PNTG" ? "mac" : imageFormatFromBytes(data, end - MACBINARY_HEADER);
  return format ? { format, start: MACBINARY_HEADER, end } : null;
}

// The picture `head` (a file's first bytes) says a .bin file of `size`
// bytes holds, or null.
export function binPicture(head: Uint8Array, size: number): BinPicture | null {
  const bytes = head.subarray(0, IMAGE_SIGNATURE_BYTES + MACBINARY_HEADER);
  const format = imageFormatFromBytes(bytes.subarray(0, IMAGE_SIGNATURE_BYTES), size);
  return format ? { format, start: 0, end: size } : macBinaryPicture(bytes, size);
}

// The image format a whole .bin file holds, or null.
export function binImageFormat(bytes: Uint8Array): string | null {
  return binPicture(bytes, bytes.length)?.format ?? null;
}

// How much of a chosen file binPicture needs, so a disc image of several
// gigabytes is refused without being read whole.
export const BIN_HEAD_BYTES = IMAGE_SIGNATURE_BYTES + MACBINARY_HEADER;

export function notAnImageMessage(to: string): string {
  return (
    `This file isn't an image, so it can't become a ${to.toUpperCase()}. Only pictures saved as .bin files ` +
    "convert, such as Outlook's ATT00001.bin attachments."
  );
}

// `format`: what the file's first bytes say it is.
export function unreadableImageMessage(format: string): string {
  return `This file starts like ${imageName(format)} image, but the picture in it couldn't be read: it may be damaged or incomplete.`;
}

// For a failure that isn't the file's: an engine that didn't load, ran out
// of memory, or failed some other way.
export function binConvertFailedMessage(format: string, to: string): string {
  const name = imageName(format).replace(/^an? /, "");
  return `The ${name} image in this file couldn't be converted to ${to.toUpperCase()}. Try again, or reload the page.`;
}

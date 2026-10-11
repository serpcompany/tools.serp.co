// What Image to PDF (image-pdf.ts) reads, and its limits. Kept apart from
// image-pdf.ts so the page knows which files it takes without loading
// pdf-lib or a decoder.

import { MAGICK_BROWSER_INPUTS } from "./magickBrowser.ts";

// Every image input the site's engines read: the browser's decoders (with
// texture-formats.ts for ICNS and KTX), libheif, and ImageMagick WASM with
// camera RAW. Fonts are left out: ImageMagick draws them as a specimen, but
// they aren't images. JPS is a stereo JPEG, side by side.
const BROWSER_INPUTS = [
  "jpg", "jpeg", "jfif", "jif", "jps", "png", "gif", "webp", "bmp", "avif", "ico", "cur", "svg",
  "icns", "ktx", "ktx2",
];
const HEIF_INPUTS = ["heic", "heif"];
const NOT_IMAGES = new Set(["ttf", "otf"]);

export const IMAGE_PDF_INPUTS: readonly string[] = [
  ...BROWSER_INPUTS,
  ...HEIF_INPUTS,
  ...[...MAGICK_BROWSER_INPUTS].filter((format) => !NOT_IMAGES.has(format)),
];
const INPUT_SET = new Set(IMAGE_PDF_INPUTS);

// For the file picker: image/* lets a phone offer its photo library; the
// extensions cover what browsers don't type as images (camera RAW, XCF...).
export const IMAGE_PDF_ACCEPT = ["image/*", ...IMAGE_PDF_INPUTS.map((format) => `.${format}`)].join(",");

// A PDF built in a browser tab is held in memory whole, about three times
// over while it's saved (pdf-lib's objects, the saved bytes, the download),
// so the pages' image data stops at 250 MB: about 750 MB at the peak, which
// a desktop tab and a recent phone's both hold. Past 100 images the list and
// the wait get unwieldy before memory does.
export const IMAGE_PDF_MAX_IMAGES = 100;
export const IMAGE_PDF_MAX_BYTES = 250 * 1024 * 1024;

export function tooManyImagesMessage(count: number): string {
  return `A PDF made here holds up to ${IMAGE_PDF_MAX_IMAGES} images, and you chose ${count}. Make two PDFs instead.`;
}

// `fitting`: how many images, from the first, fit within the limit.
export function pdfTooLargeMessage(fitting: number): string {
  const limit = `${IMAGE_PDF_MAX_BYTES / 1024 / 1024} MB`;
  if (fitting === 0) return `This image makes a PDF over ${limit}, more than a browser tab can build safely.`;
  const fit = fitting === 1 ? "Only the first image fits" : `The first ${fitting} images fit`;
  return `These images make a PDF over ${limit}, more than a browser tab can build safely. ${fit}: remove some, or make two PDFs.`;
}

function extensionOf(fileName: string): string {
  const match = /\.([^./\\]+)$/.exec(fileName);
  return match ? match[1]!.toLowerCase() : "";
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

// Brands of an ISO media file (HEIF, AVIF, CR3): the major brand, then the
// compatible ones.
function ftypBrands(head: Uint8Array): string[] {
  if (head.length < 16 || ascii(head, 4, 4) !== "ftyp") return [];
  const size = Math.min(((head[0]! << 24) | (head[1]! << 16) | (head[2]! << 8) | head[3]!) >>> 0, head.length);
  const brands = [ascii(head, 8, 4)];
  for (let offset = 16; offset + 4 <= size; offset += 4) brands.push(ascii(head, offset, 4));
  return brands;
}

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

// The format the bytes say, for the formats whose decoder would refuse a
// file named as something else: JPEG, PNG, GIF, WebP, HEIC and AVIF. TIFF
// isn't sniffed, since most camera RAW files are TIFF underneath.
function sniffImageFormat(head: Uint8Array): string | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
  if (head.length >= 8 && ascii(head, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (head.length >= 6 && (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")) return "gif";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "webp";
  const brands = ftypBrands(head);
  if (brands.includes("avif") || brands.includes("avis")) return "avif";
  if (brands.some((brand) => HEIF_BRANDS.has(brand)) && !brands.includes("crx ")) return "heic";
  return null;
}

// The format to read a file as: what its first bytes say, else its
// extension. Null when this page can't read it.
export function imageFormatOf(fileName: string, head: Uint8Array): string | null {
  const sniffed = sniffImageFormat(head);
  if (sniffed) return sniffed;
  const extension = extensionOf(fileName);
  return INPUT_SET.has(extension) ? extension : null;
}

// One image keeps its name; a combined PDF is named after its first page.
export function imagePdfName(fileNames: readonly string[]): string {
  const base = (name: string) => name.replace(/\.[^.]+$/, "") || "image";
  const first = base(fileNames[0] ?? "image");
  return fileNames.length > 1 ? `${first}_combined.pdf` : `${first}.pdf`;
}

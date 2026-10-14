// What Image to PDF (image-pdf.ts) reads, and its limits. Kept apart from
// image-pdf.ts so the page knows which files it takes without loading
// pdf-lib or a decoder.

import { imageFormatFromBytes } from "./image-signature.ts";
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

// The most pixels an image is decoded to on its way into a PDF: 50
// megapixels, 200 MB of RGBA once decoded, before the PDF so far and the
// decoder's own copies. The largest images the page was run with were 48.8
// megapixels (an 8064 x 6048 HEIC and an 8000 x 6000 PNG), which every 48 MP
// phone camera's full-size photo is, and the tab held them. A JPEG that goes
// in as it is isn't decoded, so it isn't held to this.
export const IMAGE_PDF_MAX_PIXELS = 50_000_000;

export function imageTooLargeMessage(fileName: string, width: number, height: number): string {
  const size = `${width.toLocaleString("en-US")} x ${height.toLocaleString("en-US")} pixels`;
  return `${fileName} is ${size}, over the ${IMAGE_PDF_MAX_PIXELS / 1_000_000} megapixels a browser tab can turn into a PDF page safely. Make it smaller first.`;
}

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

// The formats whose decoder would refuse a file named as something else:
// JPEG, PNG, GIF, WebP, HEIC and AVIF. TIFF isn't trusted over the name,
// since most camera RAW files are TIFF underneath.
const SNIFFED_FORMATS = new Set(["jpg", "png", "gif", "webp", "heic", "avif"]);

function sniffImageFormat(head: Uint8Array): string | null {
  const format = imageFormatFromBytes(head);
  return format && SNIFFED_FORMATS.has(format) ? format : null;
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

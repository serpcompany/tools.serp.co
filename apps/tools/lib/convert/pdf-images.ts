// PDF and AI to an image (#284): pdf.js draws each page on an opaque white
// page, as a PDF reader shows it, at the size pageRenderScale gives (twice
// its size in points, within MAX_RENDER_PIXELS), and each becomes one file.
// PNG and JPEG are the canvas's own encodings, as PDF to PNG and JPG have
// always been. Every other format is encoded from the page's pixels by
// encodeFromRGBA, as an image converted to it is: ImageMagick writes TIFF,
// PSD, BMP, GIF, PPM, RGB and TGA, the canvas WebP. A file pdf.js can't open,
// one behind a password, and one whose images the tab couldn't hold
// (PDF_IMAGE_LIMITS) are refused, each with its own code.

import { encodeFromRGBA } from "./encode.ts";
import {
  loadPdfjs,
  pageCanvasSize,
  pageRenderScale,
  type PdfCanvasContext,
  type PdfjsModule,
  type PdfjsPage,
} from "./pdf.ts";

export type PdfImageRefusal = "unreadable_pdf" | "password_protected" | "too_large";

export class PdfImageError extends Error {
  readonly code: PdfImageRefusal;
  constructor(code: PdfImageRefusal, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PdfImageError";
    this.code = code;
  }
}

// What the converted pages may come to: a page count, refused before any
// page is drawn, and the bytes of the files made, all held in the tab until
// they're saved. A format encoded from the pages' pixels takes at most
// BYTES_PER_PIXEL a pixel (an uncompressed TIFF, BMP or TGA takes that), so
// a file whose pages would pass `bytes` at that is refused before any page
// is drawn; PNG and JPEG are counted as they're made.
export const PDF_IMAGE_LIMITS = { pages: 1_000, bytes: 1_000_000_000 };
export type PdfImageLimits = typeof PDF_IMAGE_LIMITS;
const BYTES_PER_PIXEL = 4;

// The formats a page's canvas saves itself in.
const CANVAS_TYPES: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
const JPEG_QUALITY = 0.9;
// encodeFromRGBA's, for the lossy formats it writes (WebP).
const ENCODE_QUALITY = 0.85;

const count = (value: number) => value.toLocaleString("en-US");
// What the visitor uploaded: an AI file is a PDF inside.
const kind = (from: string) => (from === "ai" ? "AI file" : "PDF");

export const damagedMessage = (from: string) =>
  from === "ai"
    ? "This AI file couldn't be read: the PDF inside it may be damaged or incomplete."
    : "This file couldn't be read as a PDF: it may be damaged or incomplete, or not a PDF at all.";
export const passwordMessage = (from: string) =>
  `This ${kind(from)} is password-protected, so its pages can't be opened here. Open it with its password, save or print a copy without one, and convert that copy.`;
export const tooManyPagesMessage = (from: string, pages: number, limit: number) =>
  `This ${kind(from)} has ${count(pages)} pages; up to ${count(limit)} can be converted to images here at once. Split it into smaller files and convert each.`;
export const tooLargeMessage = (from: string, to: string, pages: number, fit: number) =>
  `This ${kind(from)}'s ${count(pages)} pages are too large to convert to ${to.toUpperCase()} here at once: up to about ${count(fit)} pages of their size can be. Split it into smaller files and convert each.`;
export const tooMuchOutputMessage = (from: string, to: string, page: number, pages: number) =>
  `This ${kind(from)}'s ${to.toUpperCase()} images grew past what can be held here at once by page ${count(page)} of ${count(pages)}, so converting stopped. Split it into smaller files and convert each.`;

// The errors pdf.js marks for a file it can't open: one that isn't a PDF, or
// is cut short or damaged past repair, and one with a password. Others are
// passed on as they are.
function refusalFor(error: unknown, from: string): unknown {
  if (error instanceof PdfImageError) return error;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "InvalidPDFException") return new PdfImageError("unreadable_pdf", damagedMessage(from), error);
  if (name === "PasswordException") return new PdfImageError("password_protected", passwordMessage(from), error);
  return error;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type Canvas = HTMLCanvasElement | OffscreenCanvas;

function createCanvas(width: number, height: number): Canvas {
  return typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
}

async function canvasBlob(canvas: Canvas, type: string, quality?: number): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`The page couldn't be saved as ${type}.`))), type, quality),
  );
}

// One page drawn at `scale` and saved as `to`. The canvas is emptied once
// its pixels are read, so a large page's memory goes before it's encoded.
async function pageImage(page: PdfjsPage, scale: number, to: string, quality: number): Promise<ArrayBuffer> {
  const viewport = page.getViewport({ scale });
  const { width, height } = pageCanvasSize(viewport);
  const canvas = createCanvas(width, height);
  try {
    const context = canvas.getContext("2d") as PdfCanvasContext | null;
    if (!context) throw new Error("Failed to create 2D canvas context.");
    // pdf.js paints this first: a page has no transparent background, in a
    // format with alpha or without.
    await page.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
    const type = CANVAS_TYPES[to];
    if (type) return await (await canvasBlob(canvas, type, type === "image/jpeg" ? JPEG_QUALITY : undefined)).arrayBuffer();
    const { data } = context.getImageData(0, 0, width, height);
    canvas.width = 0;
    canvas.height = 0;
    return await (await encodeFromRGBA(to, { data, width, height }, quality)).arrayBuffer();
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

// Each page of a PDF, or of the PDF an AI file is (`from`), as a `to` file,
// in page order. `onProgress` hears the share of pages done.
export async function convertPdfPages(
  buf: ArrayBuffer,
  to: string,
  options: {
    from?: string;
    quality?: number;
    onProgress?: (share: number) => void;
    limits?: Partial<PdfImageLimits>;
    pdfjs?: PdfjsModule;
  } = {},
): Promise<ArrayBuffer[]> {
  const from = options.from ?? "pdf";
  const target = to.toLowerCase();
  const limits = { ...PDF_IMAGE_LIMITS, ...options.limits };
  const pdfjs = options.pdfjs ?? (await loadPdfjs<PdfjsModule>());
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    if (doc.numPages > limits.pages) {
      throw new PdfImageError("too_large", tooManyPagesMessage(from, doc.numPages, limits.pages));
    }
    // Every page's scale and pixels first, so a file too large to hold as
    // images is refused before a page is drawn.
    const scales: number[] = [];
    let pixels = 0;
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const size = page.getViewport({ scale: 1 });
      const scale = pageRenderScale(size.width, size.height);
      const canvas = pageCanvasSize(page.getViewport({ scale }));
      scales.push(scale);
      pixels += canvas.width * canvas.height;
    }
    if (!CANVAS_TYPES[target] && pixels * BYTES_PER_PIXEL > limits.bytes) {
      const fit = Math.max(1, Math.floor(limits.bytes / BYTES_PER_PIXEL / (pixels / doc.numPages)));
      throw new PdfImageError("too_large", tooLargeMessage(from, target, doc.numPages, fit));
    }
    const buffers: ArrayBuffer[] = [];
    let bytes = 0;
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const buffer = await pageImage(page, scales[number - 1]!, target, options.quality ?? ENCODE_QUALITY);
      page.cleanup?.();
      bytes += buffer.byteLength;
      if (bytes > limits.bytes) {
        throw new PdfImageError("too_large", tooMuchOutputMessage(from, target, number, doc.numPages));
      }
      buffers.push(buffer);
      options.onProgress?.(number / doc.numPages);
    }
    return buffers;
  } catch (error) {
    throw refusalFor(error, from);
  } finally {
    // A worker that hangs never answers destroy().
    await Promise.race([task.destroy().catch(() => {}), wait(1_000)]);
  }
}

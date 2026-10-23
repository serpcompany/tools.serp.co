// lib/convert/pdf.ts
// pdf.js, self-hosted, and the size a page is drawn at. pdf-images.ts draws
// pages as images, and pdf-text.ts reads their text.

const workerPublicUrl = "/vendor/pdfjs/pdf.worker.min.js";
export type PdfCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type PdfjsViewport = { width: number; height: number };

export type PdfjsPage = {
  getViewport: (options: { scale: number }) => PdfjsViewport;
  render: (options: {
    canvasContext: PdfCanvasContext;
    viewport: PdfjsViewport;
    background?: string;
  }) => { promise: Promise<void> };
  cleanup?: () => unknown;
};

export type PdfjsDocument = {
  numPages: number;
  getPage: (page: number) => Promise<PdfjsPage>;
};

export type PdfjsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { data: Uint8Array; isEvalSupported?: boolean; verbosity?: number }) => {
    promise: Promise<PdfjsDocument>;
    destroy: () => Promise<void>;
  };
};

let pdfjsPromise: Promise<unknown> | null = null;

// pdf.js, self-hosted under /vendor/pdfjs/, with its worker's URL set. The
// caller types the part of the module it uses (pdf-text.ts reads text).
export async function loadPdfjs<Module = PdfjsModule>(): Promise<Module> {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* webpackIgnore: true */ "/vendor/pdfjs/pdf.min.mjs").catch(
      () => import("pdfjs-dist/legacy/build/pdf"),
    );
  }
  const pdfjsLib = (await pdfjsPromise) as PdfjsModule;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerPublicUrl;
  return pdfjsLib as unknown as Module;
}

// Safari's canvas area limit, the smallest of the browsers': a larger canvas
// renders blank or fails, and its RGBA copies run to gigabytes.
export const MAX_RENDER_PIXELS = 4096 * 4096;

// Pages render at twice their size in points, or smaller when that would
// pass MAX_RENDER_PIXELS (an Illustrator artboard can be 6912 pt square).
export function pageRenderScale(width: number, height: number) {
  const pixels = (scale: number) => Math.ceil(width * scale) * Math.ceil(height * scale);
  let scale = Math.min(2, Math.floor(Math.sqrt(MAX_RENDER_PIXELS / (width * height)) * 1000) / 1000);
  while (scale > 0.001 && pixels(scale) > MAX_RENDER_PIXELS) {
    scale = Math.round((scale - 0.001) * 1000) / 1000;
  }
  return scale;
}

// The canvas a page of `viewport`'s size is drawn on, in whole pixels, as a
// canvas takes them (a fraction is dropped), and never empty.
export function pageCanvasSize(viewport: PdfjsViewport): { width: number; height: number } {
  return { width: Math.max(1, Math.floor(viewport.width)), height: Math.max(1, Math.floor(viewport.height)) };
}

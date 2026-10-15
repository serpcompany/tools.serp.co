// Which conversions image-documents.ts, image-text.ts, table-outputs.ts,
// document-images.ts and svg-font.ts write. Kept apart from them so the
// converter can route without loading fflate, jsPDF, svg2pdf, docx-preview,
// three.js, Graphviz, pptx-glimpse, svgicons2svgfont or svg2ttf.

export const EPUB_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function isImageDocumentConversion(from: string, to: string): boolean {
  const source = from.toLowerCase();
  const target = to.toLowerCase();
  if (source === "svg") return target === "html" || target === "ai";
  return target === "epub" && source in EPUB_IMAGE_TYPES;
}

// JPG or PNG to TXT (OCR) or DOCX, written by image-text.ts.
export function isImageTextConversion(from: string, to: string): boolean {
  return ["png", "jpg", "jpeg"].includes(from.toLowerCase()) && ["txt", "docx"].includes(to.toLowerCase());
}

// CSV to an image: the table drawn by table-outputs.ts (CSV to JPG; the other
// CSV Tools are table converter pages).
export function isTableImageConversion(from: string, to: string): boolean {
  return from.toLowerCase() === "csv" && ["png", "jpg", "jpeg"].includes(to.toLowerCase());
}

// A file drawn as an image by document-images.ts: a picture of each DOCX
// page, of the DXF drawing, of the HTML page, of a plain-text file (#265),
// of a Graphviz DOT graph, of each sheet of an XLSX workbook, or of each
// slide of a PowerPoint file. (HTML to PNG and to JPEG are table converter
// pages, which don't come here.)
export const DOCUMENT_IMAGE_INPUTS = new Set(["docx", "dxf", "html", "txt", "dot", "xlsx", "pptx"]);
// The library or renderer that draws each, as telemetry and the Tool sweep
// name it.
export const DOCUMENT_IMAGE_ENGINES: Record<string, string> = {
  docx: "docx-preview",
  dxf: "dxf-viewer",
  html: "html-render",
  txt: "text-render",
  dot: "viz-js",
  xlsx: "xlsx-table",
  pptx: "pptx-glimpse",
};
const DOCUMENT_IMAGE_OUTPUTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "svg"]);

export function isDocumentImageConversion(from: string, to: string): boolean {
  return DOCUMENT_IMAGE_INPUTS.has(from.toLowerCase()) && DOCUMENT_IMAGE_OUTPUTS.has(to.toLowerCase());
}

// SVG to TTF: the SVG's filled shapes as one glyph of a font, on U+E000
// (svg-font.ts, #251).
export function isSvgFontConversion(from: string, to: string): boolean {
  return from.toLowerCase() === "svg" && to.toLowerCase() === "ttf";
}

// A larger SVG isn't made into a font, and is refused before the page reads
// it: an icon's SVG is a few kilobytes, a detailed illustration a few
// megabytes.
export const SVG_FONT_MAX_BYTES = 10 * 1024 * 1024;
export const SVG_FONT_TOO_LARGE_MESSAGE =
  "This SVG is too large to make a font from here (over 10 MB). An icon's SVG is usually a few kilobytes.";

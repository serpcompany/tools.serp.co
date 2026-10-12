// Which conversions image-documents.ts, image-text.ts, table-outputs.ts and
// document-images.ts write. Kept apart from them so the converter can route
// without loading fflate, jsPDF, svg2pdf, docx-preview, three.js, Graphviz
// or pptx-glimpse.

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

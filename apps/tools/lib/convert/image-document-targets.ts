// Which conversions image-documents.ts, image-text.ts and table-outputs.ts write. Kept
// apart from them so the converter can route without loading fflate, jsPDF or svg2pdf.

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

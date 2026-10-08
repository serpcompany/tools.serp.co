// Which conversions image-documents.ts writes. Kept apart from it so the
// converter can route without loading fflate, jsPDF or svg2pdf.

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

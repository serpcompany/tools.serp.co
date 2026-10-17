// PDF to TXT, HTML and EPUB: a PDF's text, read with pdf.js and written by
// pdf-text.ts (#282). Kept apart from it so the converter and the Tool sweep
// can route without loading pdf.js or fflate.

export const PDF_TEXT_OUTPUTS: ReadonlySet<string> = new Set(["txt", "html", "epub"]);

export function isPdfTextConversion(from: string, to: string): boolean {
  return from.toLowerCase() === "pdf" && PDF_TEXT_OUTPUTS.has(to.toLowerCase());
}

// The reasons a PDF's text isn't converted that the visitor can act on, as
// telemetry codes (pdf-text.ts throws a PdfTextError with one). Any other
// failure is pdf.js's or the browser's.
export type PdfTextRefusal = "unreadable_pdf" | "password_protected" | "no_text" | "too_large" | "read_timeout";
export const PDF_TEXT_REFUSALS: ReadonlySet<string> = new Set<PdfTextRefusal>([
  "unreadable_pdf",
  "password_protected",
  "no_text",
  "too_large",
  "read_timeout",
]);

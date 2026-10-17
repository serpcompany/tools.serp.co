// TXT and XML to PDF (#283): a plain-text file's lines, or an XML file's
// elements, attributes and text as an indented listing, on A4 pages written
// by text-pdf.ts with jsPDF. Kept apart from it so the converter and the Tool
// sweep can route, and the page can refuse a file by its size, without
// loading jsPDF or sax.

// The input formats, and the engine each is labelled with in telemetry and
// the Tool sweep.
export const TEXT_PDF_ENGINES: Readonly<Record<string, string>> = { txt: "text-pdf", xml: "xml-pdf" };

export function isTextPdfConversion(from: string, to: string): boolean {
  return to.toLowerCase() === "pdf" && Object.hasOwn(TEXT_PDF_ENGINES, from.toLowerCase());
}

// A file is refused past either: its size, before the page reads it, and the
// pages it would fill, counted as it is laid out. A 2,000-page PDF of text
// took about 2 s and 120 MB to write in Node, 3 s and 230 MB in the Unicode
// font (jsPDF 4.2.1); a page holds 61 lines of 81 characters, so 2,000 pages
// hold about 10 million characters.
export const TEXT_PDF_LIMITS = { bytes: 20 * 1024 * 1024, pages: 2_000 };

// The reasons a file isn't converted that the visitor can act on, as
// telemetry codes (text-pdf.ts throws a TextPdfError with one). Any other
// failure is jsPDF's or the browser's.
export type TextPdfRefusal = "too_large" | "unsupported_script" | "malformed_xml" | "unsupported_encoding" | "no_text";
export const TEXT_PDF_REFUSALS: ReadonlySet<string> = new Set<TextPdfRefusal>([
  "too_large",
  "unsupported_script",
  "malformed_xml",
  "unsupported_encoding",
  "no_text",
]);

export class TextPdfError extends Error {
  readonly code: TextPdfRefusal;
  constructor(code: TextPdfRefusal, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TextPdfError";
    this.code = code;
  }
}

const MB = 1024 * 1024;
const count = (value: number) => value.toLocaleString("en-US");

export const tooLargeFileMessage = (bytes: number, limit = TEXT_PDF_LIMITS.bytes) =>
  `This file is ${(bytes / MB).toFixed(1)} MB; files up to ${count(Math.floor(limit / MB))} MB can be converted to PDF here.`;
export const tooManyPagesMessage = (limit = TEXT_PDF_LIMITS.pages) =>
  `This file would fill more than ${count(limit)} pages, the most a PDF made here can have. Split it into smaller files and convert each.`;

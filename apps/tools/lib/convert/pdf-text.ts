// PDF to TXT, HTML and EPUB (#282): a PDF's text, page by page, read with
// pdf.js's text content and rebuilt into lines and paragraphs. Only the text
// is kept, in the order the PDF stores it, which is usually reading order:
// layout, columns, tables, fonts and images are not. The text is untrusted:
// every run is cleaned once as it's read (cleanText), and the HTML and XHTML
// writers escape it.

import { escapeXml, writeEpub, xmlChars } from "./image-documents.ts";
import { loadPdfjs } from "./pdf.ts";
import type { PdfTextRefusal } from "./pdf-text-targets.ts";

// What pdf.js gives and takes here (pdfjs-dist 6 in Node, the 5.4 build in
// public/vendor/pdfjs in the browser). A marked-content item has no `str`.
type TextItem = { str: string; hasEOL?: boolean; transform?: number[] };
type TextChunk = { items: Array<TextItem | { type: string }>; lang?: string | null };
type PdfjsTextPage = {
  streamTextContent: () => ReadableStream<TextChunk>;
  cleanup?: () => unknown;
};
type PdfjsTextDocument = { numPages: number; getPage: (page: number) => Promise<PdfjsTextPage> };
type PdfjsWorker = { destroy: () => void };
export type PdfjsText = {
  PDFWorker: new () => PdfjsWorker;
  getDocument: (source: {
    data: Uint8Array;
    worker: PdfjsWorker;
    isEvalSupported: boolean;
    verbosity: number;
  }) => { promise: Promise<PdfjsTextDocument>; destroy: () => Promise<void> };
};

// A file is refused only past one of these, each counted exactly as the file
// is read: its page count, the characters of text read so far, and the time
// spent reading. A 2,000-page book holds about 6 million characters; 19.5
// million converted to each format in under 3 seconds in Chromium (#282).
export const PDF_TEXT_LIMITS = { pages: 2_000, characters: 20_000_000, milliseconds: 120_000 };
export type PdfTextLimits = typeof PDF_TEXT_LIMITS;

export class PdfTextError extends Error {
  readonly code: PdfTextRefusal;
  constructor(code: PdfTextRefusal, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PdfTextError";
    this.code = code;
  }
}

const count = (value: number) => value.toLocaleString("en-US");

export const DAMAGED_MESSAGE =
  "This file couldn't be read as a PDF: it may be damaged or incomplete, or not a PDF at all.";
export const PASSWORD_MESSAGE =
  "This PDF is password-protected, so its text can't be read here. Open it with its password, save or print a copy without one, and convert that copy.";
export const NO_TEXT_MESSAGE =
  "This PDF has no text to extract: its pages are pictures, as a scan's are. Reading the words in a picture needs OCR, which this converter doesn't do.";
export const tooManyPagesMessage = (pages: number, limit: number) =>
  `This PDF has ${count(pages)} pages; up to ${count(limit)} can be converted here.`;
export const tooMuchTextMessage = (limit: number) =>
  `This PDF has more text than can be converted here (over ${count(limit)} characters).`;
export const readTimeoutMessage = (milliseconds: number) =>
  `This PDF took too long to read (over ${count(Math.round(milliseconds / 1000))} seconds), so it was stopped.`;

// A run of text as every output holds it: no character XML forbids, no DEL
// or C1 control (a font's unmapped codes, never text), and tabs and line
// breaks as spaces, since lines come from where the runs are.
export function cleanText(value: string): string {
  return xmlChars(value).replace(/[\u007F-\u009F]/g, "").replace(/[\t\n\r]/g, " ");
}

// One line of a page: its text, where its baseline is across the page's lines
// (up the page, for horizontal text) and its largest font size, in points;
// no position when it has no text.
type Line = { text: string; offset: number | null; size: number };

// Where a run sits across its lines and its font size, from its text matrix
// [a b c d e f]: (c, d) is the run's "up", scaled by its font size.
function placement(transform: number[] | undefined): { offset: number; size: number } | null {
  if (!transform || transform.length < 6) return null;
  const [, , c = 0, d = 0, e = 0, f = 0] = transform;
  const size = Math.hypot(c, d);
  const offset = (e * c + f * d) / size;
  return Number.isFinite(size) && size > 0 && Number.isFinite(offset) ? { offset, size } : null;
}

// Collects a page's runs into lines: a line ends where pdf.js marks one
// (hasEOL), and its spaces are collapsed.
class LineReader {
  readonly lines: Line[] = [];
  private current: Line = { text: "", offset: null, size: 0 };

  add(item: TextItem) {
    const text = cleanText(item.str);
    if (text.trim()) {
      const at = placement(item.transform);
      if (at) {
        this.current.offset ??= at.offset;
        this.current.size = Math.max(this.current.size, at.size);
      }
    }
    this.current.text += text;
    if (item.hasEOL) this.end();
  }

  end() {
    this.lines.push({ ...this.current, text: this.current.text.replace(/\s+/g, " ").trim() });
    this.current = { text: "", offset: null, size: 0 };
  }

  finish(): Line[] {
    if (this.current.text) this.end();
    return this.lines;
  }
}

// How far below `previous` the next line is, in font sizes (negative when it
// is above it), or null when either has no position.
function step(previous: Line, next: Line): number | null {
  if (previous.offset === null || next.offset === null) return null;
  return (previous.offset - next.offset) / Math.max(previous.size, next.size);
}

// A page's lines grouped into paragraphs, each a list of lines. A paragraph
// ends at an empty line, where the next line is higher up the page (a new
// column or block), where the font size changes by more than a fifth (a
// heading), or where the gap to the next line is wider than the page's usual
// line spacing: 1.3 times the lower quartile of its gaps, or of 1.2 font
// sizes on a page with too few lines to tell, and at most 4 font sizes.
// Lines side by side (half a font size apart or less) stay together.
export function paragraphs(lines: readonly Line[]): string[][] {
  const steps = lines.slice(1).map((line, index) => step(lines[index]!, line));
  const spacings = steps.filter((value): value is number => value !== null && value > 0.5 && value < 4).sort((a, b) => a - b);
  const usual = spacings.length >= 3 ? spacings[Math.floor(spacings.length / 4)]! : 1.2;
  const breakAt = Math.min(4, 1.3 * usual);

  const result: string[][] = [];
  let paragraph: string[] = [];
  const close = () => {
    if (paragraph.length) result.push(paragraph);
    paragraph = [];
  };
  lines.forEach((line, index) => {
    if (!line.text) return close();
    const previous = lines[index - 1];
    const gap = steps[index - 1];
    if (previous && paragraph.length && gap !== null && gap !== undefined) {
      const heading = Math.max(previous.size, line.size) > 1.2 * Math.min(previous.size, line.size);
      if (gap < -0.5 || gap > breakAt || heading) close();
    }
    paragraph.push(line.text);
  });
  close();
  return result;
}

// A BCP 47 tag, as a PDF's /Lang should hold; otherwise English.
function languageTag(value: string | null | undefined): string {
  return value && value.length <= 35 && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(value) ? value : "en";
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

// The errors pdf.js marks for a file it can't open: one that isn't a PDF, or
// is cut short or damaged past repair, and one with a password. Others are
// passed on as they are.
function refusalFor(error: unknown): unknown {
  if (error instanceof PdfTextError) return error;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "InvalidPDFException") return new PdfTextError("unreadable_pdf", DAMAGED_MESSAGE, error);
  if (name === "PasswordException") return new PdfTextError("password_protected", PASSWORD_MESSAGE, error);
  return error;
}

// A PDF's text: each page's paragraphs (lists of lines), in page order, and
// the language the PDF says it's in. pdf.js runs in its own worker, which is
// stopped once the text is read, or when reading takes too long, even if it
// hangs. `onProgress` hears the share of pages read.
export type PdfText = { pages: string[][][]; language: string };

export async function readPdfText(
  buf: ArrayBuffer,
  options: { pdfjs?: PdfjsText; limits?: Partial<PdfTextLimits>; onProgress?: (share: number) => void } = {},
): Promise<PdfText> {
  const limits = { ...PDF_TEXT_LIMITS, ...options.limits };
  const pdfjs = options.pdfjs ?? (await loadPdfjs<PdfjsText>());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PdfTextError("read_timeout", readTimeoutMessage(limits.milliseconds))),
      limits.milliseconds,
    );
  });
  deadline.catch(() => {});
  const inTime = <T>(promise: Promise<T>) => Promise.race([promise, deadline]);

  const worker = new pdfjs.PDFWorker();
  let task: ReturnType<PdfjsText["getDocument"]> | undefined;
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(buf), worker, isEvalSupported: false, verbosity: 0 });
    const doc = await inTime(task.promise);
    if (doc.numPages > limits.pages) {
      throw new PdfTextError("too_large", tooManyPagesMessage(doc.numPages, limits.pages));
    }
    const pages: string[][][] = [];
    let characters = 0;
    let language: string | null = null;
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await inTime(doc.getPage(number));
      // Read as it streams, to stop as soon as the text passes its limit. A
      // stream left unread is ended with the document; cancelling it first
      // races pdf.js's own teardown.
      const reader = page.streamTextContent().getReader();
      const lines = new LineReader();
      for (;;) {
        const { value, done } = await inTime(reader.read());
        if (done) break;
        language ??= value.lang ?? null;
        for (const item of value.items) {
          if (!("str" in item) || typeof item.str !== "string") continue;
          characters += item.str.length;
          if (characters > limits.characters) {
            throw new PdfTextError("too_large", tooMuchTextMessage(limits.characters));
          }
          lines.add(item);
        }
      }
      page.cleanup?.();
      pages.push(paragraphs(lines.finish()));
      options.onProgress?.(number / doc.numPages);
    }
    if (!pages.some((page) => page.length)) throw new PdfTextError("no_text", NO_TEXT_MESSAGE);
    return { pages, language: languageTag(language) };
  } catch (error) {
    throw refusalFor(error);
  } finally {
    clearTimeout(timer);
    // A worker that hangs never answers destroy(); stopping it ends it.
    if (task) await Promise.race([task.destroy().catch(() => {}), wait(1_000)]);
    worker.destroy();
  }
}

// Lines of a paragraph, run together for a reader to reflow.
const flowing = (paragraph: string[]) => paragraph.join(" ");

// The text: a paragraph's lines on lines of their own, a blank line after
// each paragraph and between pages. Pages without text add nothing.
export function pdfTextToTxt({ pages }: PdfText): string {
  const text = pages
    .filter((page) => page.length)
    .map((page) => page.map((paragraph) => paragraph.join("\n")).join("\n\n"))
    .join("\n\n");
  return `${text}\n`;
}

// One HTML page: a <section> a page, a <p> a paragraph. Nothing in it loads
// or runs (its Content-Security-Policy allows only its own style).
export function pdfTextToHtml({ pages, language }: PdfText, title: string): string {
  const sections = pages.map((page, index) => {
    const body = page.map((paragraph) => `<p>${escapeXml(flowing(paragraph))}</p>\n`).join("");
    return `<section id="page-${index + 1}" aria-label="Page ${index + 1}">\n${body}</section>\n`;
  });
  return [
    "<!DOCTYPE html>",
    `<html lang="${escapeXml(language)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeXml(title)}</title>`,
    "<style>body{max-width:42em;margin:2em auto;padding:0 1em;font:1rem/1.5 system-ui,sans-serif}section+section{margin-top:2em;padding-top:1em;border-top:1px solid #ccc}</style>",
    "</head>",
    "<body>",
    `${sections.join("")}</body>`,
    "</html>",
    "",
  ].join("\n");
}

// A reflowable EPUB 3: an XHTML document a page, in the spine in page order,
// listed as "Page 1", "Page 2"... in its table of contents.
export function pdfTextToEpub({ pages, language }: PdfText, title: string): ArrayBuffer {
  return writeEpub({
    title,
    language,
    style: "p{margin:0 0 0.8em}",
    documents: pages.map((page, index) => ({
      id: `page-${index + 1}`,
      href: `page-${index + 1}.xhtml`,
      title: `Page ${index + 1}`,
      body: `<section>${page.map((paragraph) => `<p>${escapeXml(flowing(paragraph))}</p>`).join("")}</section>`,
    })),
  });
}

// Names the pages with no text, when some have text and some don't: up to
// five by number, more by how many.
export function emptyPagesNotice({ pages }: PdfText): string | undefined {
  const empty = pages.flatMap((page, index) => (page.length ? [] : [index + 1]));
  if (!empty.length || empty.length === pages.length) return undefined;
  const one = empty.length === 1;
  const listed = empty.length > 2 ? `${empty.slice(0, -1).join(", ")} and ${empty.at(-1)}` : empty.join(" and ");
  const named =
    empty.length <= 5 ? `${one ? "Page" : "Pages"} ${listed}` : `${count(empty.length)} of ${count(pages.length)} pages`;
  return (
    `${named} ${one ? "has" : "have"} no text to extract (${one ? "it's a picture" : "they're pictures"}, ` +
    `as scanned pages are), so this file has no text from ${one ? "it" : "them"}.`
  );
}

const encode = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

// The PDF's text as TXT, HTML or EPUB, titled after the file. Throws a
// PdfTextError for a file it refuses.
export async function convertPdfText(
  buf: ArrayBuffer,
  to: string,
  fileName: string,
  options: Parameters<typeof readPdfText>[1] = {},
): Promise<{ buffer: ArrayBuffer; notice?: string }> {
  const text = await readPdfText(buf, options);
  const title = cleanText(fileName.replace(/\.[^.]+$/, "")).trim() || "document";
  const target = to.toLowerCase();
  const buffer =
    target === "txt"
      ? encode(pdfTextToTxt(text))
      : target === "html"
        ? encode(pdfTextToHtml(text, title))
        : pdfTextToEpub(text, title);
  return { buffer, notice: emptyPagesNotice(text) };
}

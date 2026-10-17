// TXT and XML to PDF (#283), in the visitor's browser: a plain-text file's
// lines, or an XML file's indented listing (xml-listing.ts), set on A4 pages
// with jsPDF, which is loaded only when a file is converted.
//
// Text in Windows-1252 is set in jsPDF's built-in Courier, so columns and
// indentation line up as in a text editor and no font is downloaded. Text
// with anything else is set in the self-hosted DejaVu Sans (pdf-font.ts),
// whose letters aren't all one width; its indentation still lines up, as it
// is set in Courier's columns. A character that font can't show (Chinese,
// Japanese, Korean, Indic, Thai, emoji) or jsPDF can't set (Lao, N'Ko)
// refuses the file, never a garbled PDF.

import {
  fetchPdfFont,
  isBuiltInText,
  isRightToLeft,
  UnsupportedScriptError,
  embedUnicodeFont,
  shapeArabic,
  withoutJoiners,
} from "./pdf-font.ts";
import { cleanLine, decodeText, textLines } from "./text-file.ts";
import {
  TEXT_PDF_LIMITS,
  TextPdfError,
  tooLargeFileMessage,
  tooManyPagesMessage,
} from "./text-pdf-targets.ts";
import { decodeXml, listXml } from "./xml-listing.ts";

// A4 in points, 3/4 inch margins and 10 pt type on 12 pt lines: 61 lines of
// 81 characters of Courier, whose characters are 0.6 em wide.
export const PAGE = { width: 595.28, height: 841.89 };
export const MARGIN = 54;
export const FONT_SIZE = 10;
export const LINE_HEIGHT = 12;
export const COLUMN_WIDTH = 0.6 * FONT_SIZE;
const TEXT_WIDTH = PAGE.width - 2 * MARGIN;
export const COLUMNS = Math.floor(TEXT_WIDTH / COLUMN_WIDTH);
export const LINES_PER_PAGE = Math.floor((PAGE.height - 2 * MARGIN) / LINE_HEIGHT);
// The first baseline: a 10 pt line's ascent, centred on its 12 pt line.
const FIRST_BASELINE = MARGIN + 9;
// The lines a wrapped line continues on are indented no more than this, so
// they keep room for their text.
const MAX_HANG = Math.floor(COLUMNS / 2);
const COLOURS = { text: [17, 24, 39], muted: [107, 114, 128] } as const;

// One line of the file, before it's wrapped: its text, how many columns it
// is indented, how many more its continuation lines are, and how it's set.
// A page break (a form feed in a text file) starts the next line on a new
// page.
export type SourceLine = {
  text: string;
  indent: number;
  hang: number;
  muted: boolean;
  // Read right to left (its first letter is Hebrew or Arabic), and set
  // against the right margin, as an editor shows a text file's line.
  rtl: boolean;
  right: boolean;
};
type Source = SourceLine | "page-break";

// A line as set on a page.
export type PlacedLine = { text: string; indent: number; muted: boolean; rtl: boolean; right: boolean };

export type TextPdfLimits = typeof TEXT_PDF_LIMITS;
export type TextPdfOptions = {
  // The Unicode font's bytes (pdf-font.ts fetches the self-hosted file).
  loadFont?: () => Promise<ArrayBuffer>;
  limits?: Partial<TextPdfLimits>;
  // The share of pages set so far.
  onProgress?: (share: number) => void;
};

// Characters no font draws: C1 controls, invisible formatting characters
// (zero-width spaces, direction marks, soft hyphens, byte order marks) and
// variation selectors. The rest is composed (NFC), so an accent typed as a
// separate mark sits on its letter, in Courier when it can. The zero-width
// non-joiner and joiner stay: in Persian, Urdu or Kurdish they say where a
// word's letters join (pdf-font.ts's shapeArabic), and the Unicode font has
// them; text in Courier drops them.
const INVISIBLE = /[\u0080-\u009f]|[\ufe00-\ufe0f]|(?!\u200c|\u200d)\p{Cf}/gu;
export const printable = (text: string) => text.normalize("NFC").replace(INVISIBLE, "");
// A line with nothing to see: spaces at most, and joiners with nothing to join.
const isBlank = (text: string) => !withoutJoiners(text).trim();

const tooLarge = (limits: TextPdfLimits) => new TextPdfError("too_large", tooManyPagesMessage(limits.pages));

// ---------------------------------------------------------------- pages --

// Where the next line goes: the pages filled before this one, and the lines
// on this one. Reading a file and laying it out both move through the pages
// with it, so they agree on what fills a page. A line goes on the next page
// when this one is full. A page break ends this page if it has a line on it
// (a blank one too), so the next line starts a new one, and does nothing on
// a page with none. Two form feeds in a row in a text file hold an empty
// line between them, so they leave a page with a blank line on it.
//
// Adding a line anywhere never moves the end back, so the pages counted on
// a file's lines as read, a line each, are never more than the layout's,
// where a line can wrap onto several.
export class PageCursor {
  readonly limit: number;
  pages = 0;
  lines = 0;
  constructor(limit: number) {
    this.limit = limit;
  }

  // How many more lines fit within the page limit; below 0 once past it.
  get room() {
    return (this.limit - this.pages) * LINES_PER_PAGE - this.lines;
  }

  get fits() {
    return this.room >= 0;
  }

  // Moves past one line. False once the line is past the page limit.
  line() {
    if (this.lines === LINES_PER_PAGE) this.pageBreak();
    this.lines += 1;
    return this.fits;
  }

  pageBreak() {
    if (!this.lines) return;
    this.pages += 1;
    this.lines = 0;
  }
}

// ---------------------------------------------------------------- input --

const BLANK_LINE: SourceLine = Object.freeze({ text: "", indent: 0, hang: 0, muted: false, rtl: false, right: false });

// A text file's lines (text-file.ts): tabs to every fourth column, control
// characters and terminal escape sequences dropped, the leading spaces as
// the line's indent. A form feed starts a new page, as on a printer
// (PageCursor); blank lines and page breaks at the end are left out, so
// they never count. Throws as soon as the lines, a line each, pass the page
// limit; layoutPages counts the lines they wrap onto.
export function textSourceLines(text: string, limits: TextPdfLimits): Source[] {
  const lines: Source[] = [];
  // Where the lines read so far end, the blank lines and page breaks
  // waiting for a line with text included.
  const at = new PageCursor(limits.pages);
  // Those waiting, kept only while they fit: past the limit, a line with
  // text after them is refused.
  let waiting: Source[] = [];
  for (const { line, end } of textLines(text)) {
    const cleaned = printable(cleanLine(line)).trimEnd();
    const body = cleaned.trimStart();
    if (isBlank(body)) {
      if (at.line()) waiting.push(BLANK_LINE);
    } else {
      if (!at.line()) throw tooLarge(limits);
      for (const source of waiting) lines.push(source);
      waiting = [];
      const rtl = isRightToLeft(body);
      lines.push({ text: body, indent: cleaned.length - body.length, hang: 0, muted: false, rtl, right: rtl });
    }
    if (end === "\f") {
      at.pageBreak();
      if (at.fits) waiting.push("page-break");
    }
  }
  return lines;
}

// An XML file's listing (xml-listing.ts), left-aligned at its indent
// whatever its script. Throws as soon as the lines pass the page limit.
export function xmlSourceLines(text: string, limits: TextPdfLimits): Source[] {
  const lines: Source[] = [];
  const at = new PageCursor(limits.pages);
  listXml(text, (line) => {
    if (!at.line()) throw tooLarge(limits);
    const text = printable(line.text);
    lines.push({ text, indent: line.indent, hang: line.hang ?? 0, muted: Boolean(line.muted), rtl: isRightToLeft(text), right: false });
  });
  return lines;
}

// --------------------------------------------------------------- layout --

// `text` wrapped to `first` points on its first line and `rest` on the lines
// after: between words where it can, inside a word too long for a line.
// Spaces never start a line, and hang past its end. Each character is
// measured once, so a line of millions of characters wraps in one pass.
// Stops after `most` + 1 lines.
export function wrapText(
  text: string,
  first: number,
  rest: number,
  widthOf: (char: string) => number,
  most = Infinity,
): string[] {
  const lines: string[] = [];
  let start = 0;
  let width = 0;
  let max = first;
  // Where the last word on the line starts, the line's width before it, and
  // whether the line has a word before it to break after.
  let wordStart = -1;
  let widthBefore = 0;
  let breakable = false;
  let afterSpace = false;
  let content = false;
  const push = (end: number) => {
    lines.push(text.slice(start, end).trimEnd());
    max = rest;
    wordStart = -1;
    breakable = false;
    return lines.length > most;
  };
  for (let index = 0; index < text.length; ) {
    const code = text.codePointAt(index)!;
    const char = code > 0xffff ? text.slice(index, index + 2) : text[index]!;
    const size = widthOf(char);
    if (char === " ") {
      width += size;
      index += char.length;
      afterSpace = true;
      continue;
    }
    if (afterSpace) {
      wordStart = index;
      widthBefore = width;
      breakable = content;
      afterSpace = false;
    }
    if (width + size > max && index > start) {
      if (breakable && wordStart > start) {
        const next = wordStart;
        width -= widthBefore;
        if (push(next)) return lines;
        start = next;
      } else {
        if (push(index)) return lines;
        width = 0;
        start = index;
      }
      // The same character again, on the new line: a word wider than the
      // line breaks again where it no longer fits.
      continue;
    }
    width += size;
    content = true;
    index += char.length;
  }
  if (start < text.length || !lines.length) push(text.length);
  return lines;
}

// The lines set on each page, placed by PageCursor. Throws as soon as they
// pass the page limit.
export function layoutPages(
  sources: Iterable<Source>,
  widthOf: (char: string) => number,
  limits: TextPdfLimits,
): PlacedLine[][] {
  const pages: PlacedLine[][] = [];
  const at = new PageCursor(limits.pages);
  for (const source of sources) {
    if (source === "page-break") {
      at.pageBreak();
      continue;
    }
    const indent = Math.min(source.indent, COLUMNS - 1);
    const hang = Math.min(indent + source.hang, MAX_HANG);
    const lines = wrapText(
      source.text,
      TEXT_WIDTH - indent * COLUMN_WIDTH,
      TEXT_WIDTH - hang * COLUMN_WIDTH,
      widthOf,
      at.room,
    );
    if (lines.length > at.room) throw tooLarge(limits);
    lines.forEach((text, index) => {
      at.line();
      (pages[at.pages] ??= []).push({ text, indent: index ? hang : indent, muted: source.muted, rtl: source.rtl, right: source.right });
    });
  }
  // A file with nothing to set still makes a page.
  return pages.length ? pages : [[]];
}

// --------------------------------------------------------------- output --

type JsPdf = import("jspdf").jsPDF;

const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Sets each page's lines, a run of lines set alike in one call: in Courier
// the indent is spaces, as typed; in the Unicode font, whose spaces are
// narrower, it is the same distance across.
async function drawPages(
  doc: JsPdf,
  pages: PlacedLine[][],
  monospace: boolean,
  onProgress?: (share: number) => void,
) {
  let colour: readonly number[] = COLOURS.text;
  doc.setTextColor(...(colour as [number, number, number]));
  for (const [number, lines] of pages.entries()) {
    if (number) doc.addPage("a4", "portrait");
    let run: { texts: string[]; x: number; y: number; muted: boolean; rtl: boolean; right: boolean } | null = null;
    const flush = () => {
      if (!run) return;
      const wanted = run.muted ? COLOURS.muted : COLOURS.text;
      if (wanted !== colour) {
        colour = wanted;
        doc.setTextColor(...(colour as [number, number, number]));
      }
      // The run's direction, which pdf-font.ts's display order would
      // otherwise take from its first letter.
      doc.text(run.texts, run.x, run.y, {
        align: run.right ? "right" : "left",
        baseline: "alphabetic",
        ...(monospace ? {} : { isInputRtl: run.rtl }),
      });
      run = null;
    };
    lines.forEach((line, index) => {
      const indent = line.indent * COLUMN_WIDTH;
      const text = monospace ? `${" ".repeat(line.indent)}${line.text}` : line.text;
      const x = monospace ? MARGIN : line.right ? PAGE.width - MARGIN - indent : MARGIN + indent;
      // A blank line joins the run it's in.
      const alike = run && run.x === x && run.muted === line.muted && run.rtl === line.rtl && run.right === line.right;
      if (run && (!line.text || alike)) {
        run.texts.push(text);
        return;
      }
      flush();
      run = { texts: [text], x, y: FIRST_BASELINE + index * LINE_HEIGHT, muted: line.muted, rtl: line.rtl, right: line.right };
    });
    flush();
    if (number % 50 === 49) {
      onProgress?.((number + 1) / pages.length);
      await yieldToPage();
    }
  }
}

// What a TXT file's refusal for an unsupported script suggests instead; an
// XML file has no other way to convert here.
const SCRIPT_ADVICE: Record<string, string> = {
  txt: "Convert the text to PNG instead, which draws it with your browser's fonts.",
  xml: "",
};

// A TXT or XML file as a PDF, titled after the file. Throws a TextPdfError
// for a file it refuses.
export async function convertTextToPdf(
  buf: ArrayBuffer,
  from: string,
  fileName: string,
  options: TextPdfOptions = {},
): Promise<{ buffer: ArrayBuffer; pages: number }> {
  const limits = { ...TEXT_PDF_LIMITS, ...options.limits };
  if (buf.byteLength > limits.bytes) throw new TextPdfError("too_large", tooLargeFileMessage(buf.byteLength, limits.bytes));
  const source = from.toLowerCase();
  const bytes = new Uint8Array(buf);
  let lines = source === "xml" ? xmlSourceLines(decodeXml(bytes), limits) : textSourceLines(decodeText(bytes), limits);
  const texts = lines.flatMap((line) => (line === "page-break" ? [] : [line.text]));
  if (texts.every(isBlank)) {
    throw new TextPdfError("no_text", "This text file is empty: there's no text to put in a PDF.");
  }

  const monospace = texts.every((text) => isBuiltInText(withoutJoiners(text)));
  const [{ jsPDF }, fontBytes] = await Promise.all([
    import("jspdf"),
    monospace ? null : (options.loadFont ?? fetchPdfFont)(),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  let widthOf: (char: string) => number = () => COLUMN_WIDTH;
  if (fontBytes) {
    try {
      embedUnicodeFont(doc, fontBytes, texts, SCRIPT_ADVICE[source] ?? "");
    } catch (error) {
      if (error instanceof UnsupportedScriptError) throw new TextPdfError("unsupported_script", error.message, error);
      throw error;
    }
    const widths = new Map<string, number>();
    widthOf = (char) => {
      let width = widths.get(char);
      if (width === undefined) {
        width = doc.getStringUnitWidth(char) * FONT_SIZE;
        widths.set(char, width);
      }
      return width;
    };
  } else {
    doc.setFont("courier", "normal");
  }
  // Each line as it is drawn: without joiners in Courier, its Arabic
  // letters in their joined forms in the Unicode font.
  const drawn = (text: string) => (monospace ? withoutJoiners(text) : shapeArabic(doc, text));
  lines = lines.map((line) => {
    if (line === "page-break") return line;
    const text = drawn(line.text);
    return text === line.text ? line : { ...line, text };
  });
  doc.setFontSize(FONT_SIZE);
  doc.setLineHeightFactor(LINE_HEIGHT / FONT_SIZE);
  const title = withoutJoiners(printable(fileName.replace(/\.[^.]+$/, ""))).trim();
  // jsPDF writes the title in PDFDocEncoding, which holds Latin text only.
  if (title && isBuiltInText(title)) doc.setProperties({ title });

  const pages = layoutPages(lines, widthOf, limits);
  await drawPages(doc, pages, monospace, options.onProgress);
  return { buffer: doc.output("arraybuffer"), pages: pages.length };
}

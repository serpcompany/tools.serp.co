// A plain-text file drawn as an image (issue #265), on a canvas in the
// visitor's browser: black text on white in the self-hosted DejaVu Sans,
// which draws Latin, Greek, Cyrillic, Hebrew and Arabic (other scripts fall
// back to the browser's own sans-serif). Long lines wrap; the image is at most
// MAX_IMAGE_SIDE pixels a side, and a text too long for it is cut, with a
// last line in the image and a notice on the page saying so.
// document-images.ts loads this module only when a TXT file is converted.

import { DXF_FONT_URL, MAX_IMAGE_SIDE } from "./document-images.ts";
import type { RGBA } from "./heif.ts";
import { isRightToLeft } from "./table-image.ts";

// CSS pixels; the canvas is TEXT_SCALE times larger when that fits.
export const TEXT_FONT_SIZE = 16;
export const TEXT_LINE_HEIGHT = 24;
export const TEXT_MARGIN = 32;
// Lines wrap at this width, about 90 characters.
export const TEXT_WRAP_WIDTH = 800;
// Drawn at twice its size, as table images are, unless the text is too tall
// for that; never below 1, so the text stays readable at the image's size.
export const TEXT_SCALE = 2;
// Tabs stop every this many characters.
const TAB_SIZE = 4;
// A word longer than this many characters can't fit a line: it's broken
// without measuring all of it.
const LONGEST_FIT = 400;
// The most lines an image holds at scale 1, the cut line included.
export const MAX_TEXT_LINES = Math.floor((MAX_IMAGE_SIDE - 2 * TEXT_MARGIN) / TEXT_LINE_HEIGHT);

// The DejaVu Sans table PDFs and DXF drawings use (public/vendor/fonts/dejavu/).
export const TEXT_FONT_URL = DXF_FONT_URL;
const FONT_FAMILY = "SERP Text DejaVu Sans";
const FONT = `${TEXT_FONT_SIZE}px "${FONT_FAMILY}", "DejaVu Sans", sans-serif`;
const NOTE_FONT = `italic ${TEXT_FONT_SIZE}px "${FONT_FAMILY}", "DejaVu Sans", sans-serif`;
const COLOURS = { background: "#ffffff", text: "#111827", note: "#6b7280" };

export type MeasureText = (text: string) => number;

// The text a file holds: UTF-8 or UTF-16 when a byte order mark says so,
// else UTF-8, else (when it isn't valid UTF-8) Windows-1252, as a browser
// shows a plain-text file with no charset.
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Line breaks: CR LF, CR, LF, and the other breaks Unicode names (form
// feed, vertical tab, NEL, line and paragraph separators).
const LINE_BREAK = /\r\n|[\r\n\f\v\u0085\u2028\u2029]/g;
const ENDS_WITH_BREAK = /[\r\n\f\v\u0085\u2028\u2029]$/;
// Terminal colour codes and other escape sequences, then the control
// characters a text editor doesn't show.
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0e-\x1f\x7f]/g;

// A source line as drawn: escape sequences and control characters dropped,
// tabs as spaces to the next tab stop.
export function cleanLine(line: string): string {
  const text = line.replace(ESCAPE_SEQUENCE, "").replace(CONTROL, "");
  if (!text.includes("\t")) return text;
  let out = "";
  let column = 0;
  for (const char of text) {
    if (char === "\t") {
      const spaces = TAB_SIZE - (column % TAB_SIZE);
      out += " ".repeat(spaces);
      column += spaces;
    } else {
      out += char;
      column += 1;
    }
  }
  return out;
}

// How many lines the text has: one more than its line breaks, not counting
// a break at the very end.
export function countLines(text: string): number {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x0d) {
      if (text.charCodeAt(index + 1) === 0x0a) index += 1;
      count += 1;
    } else if (code === 0x0a || code === 0x0b || code === 0x0c || code === 0x85 || code === 0x2028 || code === 0x2029) {
      count += 1;
    }
  }
  return ENDS_WITH_BREAK.test(text) ? count - 1 : count;
}

// The longest start of `chars` (code points) that fits `width`, at least one.
function fittingPrefix(chars: string[], width: number, measure: MeasureText): number {
  let low = 1;
  let high = Math.min(chars.length, LONGEST_FIT);
  if (measure(chars.slice(0, high).join("")) <= width) return high;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(chars.slice(0, middle).join("")) <= width) low = middle;
    else high = middle - 1;
  }
  return low;
}

// A source line wrapped to `width`: between words where it can, inside a
// word too long for a line. Stops after `limit` lines.
export function wrapLine(line: string, width: number, measure: MeasureText, limit = Infinity): string[] {
  if (!line) return [""];
  const lines: string[] = [];
  let current = "";
  const tokens = line.match(/\s+|\S+\s*/g) ?? [];
  for (let token of tokens) {
    if (lines.length >= limit) break;
    const candidate = current + token;
    if (candidate.trimEnd().length <= LONGEST_FIT && measure(candidate.trimEnd()) <= width) {
      current = candidate;
      continue;
    }
    if (current.trimEnd()) {
      lines.push(current.trimEnd());
      current = "";
      if (lines.length >= limit) break;
      // Spaces that end a line aren't drawn; a word starts the next one.
      token = token.trimStart() ? token : "";
      if (!token) continue;
    }
    if (token.trimEnd().length <= LONGEST_FIT && measure(token.trimEnd()) <= width) {
      current = token;
      continue;
    }
    // A word wider than a line: as much of it as fits, a line at a time.
    let chars = Array.from(token.trimEnd());
    while (chars.length && lines.length < limit) {
      const count = fittingPrefix(chars, width, measure);
      if (count === chars.length) break;
      lines.push(chars.slice(0, count).join(""));
      chars = chars.slice(count);
    }
    current = chars.join("");
  }
  if (lines.length < limit && (current.trimEnd() || !lines.length)) lines.push(current.trimEnd());
  return lines;
}

export type TextLayout = {
  // The lines drawn, wrapped, each with its direction.
  lines: { text: string; rtl: boolean }[];
  // CSS pixels.
  width: number;
  height: number;
  // The last line, when the text doesn't fit: where it's cut.
  note: string | null;
  // The source line the image stops at, and whether it's drawn in part, or
  // null when the image shows the whole text; and how many lines it has.
  cutAt: { line: number; partial: boolean } | null;
  total: number;
};

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

// A source line is never wrapped past this many characters: more than
// MAX_TEXT_LINES lines hold, however narrow the characters (a line holds at
// most LONGEST_FIT), so a longer line is always cut.
export const MAX_LINE_CHARS = (MAX_TEXT_LINES + 1) * LONGEST_FIT;

// The text's lines, wrapped, as many as an image holds. Only the lines
// shown are measured, so a file of millions of lines lays out as fast as a
// short one. A text that doesn't fit ends in a line saying where it's cut.
export function layoutText(text: string, measure: MeasureText): TextLayout {
  const total = countLines(text);
  const lines: TextLayout["lines"] = [];
  // Source lines drawn whole.
  let shown = 0;
  let cut = false;
  // Whether the line it's cut at is drawn in part.
  let partial = false;
  let start = 0;
  while (shown < total) {
    LINE_BREAK.lastIndex = start;
    const match = LINE_BREAK.exec(text);
    const end = match ? match.index : text.length;
    const source = cleanLine(text.slice(start, Math.min(end, start + MAX_LINE_CHARS)));
    const rtl = isRightToLeft(source);
    const room = MAX_TEXT_LINES - lines.length;
    const wrapped = wrapLine(source, TEXT_WRAP_WIDTH, measure, room + 1);
    // A line with more after it leaves room for the line saying where the
    // text is cut, in case what follows doesn't fit.
    const last = shown + 1 === total;
    if (wrapped.length > (last ? room : room - 1)) {
      const shownPart = wrapped.slice(0, room - 1);
      for (const line of shownPart) lines.push({ text: line, rtl });
      partial = shownPart.length > 0;
      cut = true;
      break;
    }
    for (const line of wrapped) lines.push({ text: line, rtl });
    shown += 1;
    if (!match) break;
    start = end + match[0].length;
  }

  const where = `${partial ? "part way through" : "before"} line ${formatCount(shown + 1)} of ${formatCount(total)}`;
  const note = cut ? `… cut ${where}: an image is at most ${formatCount(MAX_IMAGE_SIDE)} px tall.` : null;
  const widest = lines.reduce((most, line) => Math.max(most, measure(line.text)), 0);
  const noteWidth = note ? Math.min(TEXT_WRAP_WIDTH, measure(note)) : 0;
  const count = lines.length + (note ? 1 : 0);
  return {
    lines,
    width: Math.ceil(Math.max(widest, noteWidth, 1)) + 2 * TEXT_MARGIN,
    height: count * TEXT_LINE_HEIGHT + 2 * TEXT_MARGIN,
    note,
    cutAt: cut ? { line: shown + 1, partial } : null,
    total,
  };
}

// The notice the page shows for a cut text.
export function textCutNotice(layout: TextLayout): string | undefined {
  if (layout.cutAt === null) return undefined;
  const { line, partial } = layout.cutAt;
  return `The text is too long for one image: it stops ${partial ? "part way through" : "before"} line ${formatCount(line)} of ${formatCount(layout.total)}, the most a ${formatCount(MAX_IMAGE_SIDE)} px image holds, and its last line says so.`;
}

// The scale the text is drawn at: TEXT_SCALE, or less when that would pass
// MAX_IMAGE_SIDE, never below 1 (the layout fits at 1).
export function textScale(width: number, height: number): number {
  return Math.max(1, Math.min(TEXT_SCALE, MAX_IMAGE_SIDE / width, MAX_IMAGE_SIDE / height));
}

// ------------------------------------------------------------- browser --

let fontLoaded: Promise<void> | null = null;

// Adds DejaVu Sans to the page's fonts once; a page that can't load it draws
// with the browser's sans-serif instead.
function loadFont(): Promise<void> {
  if (!fontLoaded) {
    fontLoaded = (async () => {
      try {
        const face = new FontFace(FONT_FAMILY, `url(${TEXT_FONT_URL})`);
        await face.load();
        document.fonts.add(face);
      } catch {
        // The fallback fonts in FONT draw the text.
      }
    })();
  }
  return fontLoaded;
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeContext(width: number, height: number): Context2D {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d") as Context2D | null;
  if (!context) throw new Error("This browser can't draw the text as an image.");
  return context;
}

export async function renderTextImage(buf: ArrayBuffer): Promise<{ rgba: RGBA; notice?: string }> {
  const text = decodeText(new Uint8Array(buf));
  if (!text.replace(CONTROL, "").trim()) throw new Error("This text file is empty: there's no text to draw.");
  await loadFont();
  const measuring = makeContext(1, 1);
  measuring.font = FONT;
  const widths = new Map<string, number>();
  const measure: MeasureText = (value) => {
    let width = widths.get(value);
    if (width === undefined) {
      width = measuring.measureText(value).width;
      widths.set(value, width);
    }
    return width;
  };
  const layout = layoutText(text, measure);
  const scale = textScale(layout.width, layout.height);
  const width = Math.min(MAX_IMAGE_SIDE, Math.ceil(layout.width * scale));
  const height = Math.min(MAX_IMAGE_SIDE, Math.ceil(layout.height * scale));
  const context = makeContext(width, height);
  context.scale(scale, scale);
  context.fillStyle = COLOURS.background;
  context.fillRect(0, 0, layout.width, layout.height);
  context.textBaseline = "middle";
  context.fillStyle = COLOURS.text;
  context.font = FONT;
  layout.lines.forEach((line, index) => {
    context.direction = line.rtl ? "rtl" : "ltr";
    context.textAlign = line.rtl ? "right" : "left";
    const x = line.rtl ? layout.width - TEXT_MARGIN : TEXT_MARGIN;
    context.fillText(line.text, x, TEXT_MARGIN + (index + 0.5) * TEXT_LINE_HEIGHT);
  });
  if (layout.note) {
    context.direction = "ltr";
    context.textAlign = "left";
    context.fillStyle = COLOURS.note;
    context.font = NOTE_FONT;
    context.fillText(layout.note, TEXT_MARGIN, TEXT_MARGIN + (layout.lines.length + 0.5) * TEXT_LINE_HEIGHT, TEXT_WRAP_WIDTH);
  }
  const data = context.getImageData(0, 0, width, height).data;
  return { rgba: { data, width, height }, notice: textCutNotice(layout) };
}

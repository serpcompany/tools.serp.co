// The Unicode font jsPDF writes text outside Windows-1252 in (#249), shared by
// the table PDFs (table-outputs.ts) and the text and XML PDFs (text-pdf.ts,
// #283). jsPDF's built-in fonts draw Windows-1252 only; anything else is
// drawn in DejaVu Sans, self-hosted and fetched only when a PDF needs it.
// Text the font has no glyph for is refused, never drawn as empty boxes.

export const PDF_FONT_URL = "/vendor/fonts/dejavu/DejaVuSans.ttf";
const PDF_FONT = "DejaVuSans";

// Text jsPDF's built-in fonts draw: Latin-1 and the rest of Windows-1252
// (their WinAnsiEncoding). Anything else needs the Unicode font.
const BUILT_IN_TEXT = /^[\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;
const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;

export function isBuiltInText(text: string): boolean {
  return BUILT_IN_TEXT.test(text);
}

// Whether a line reads right to left: its first letter is Hebrew or Arabic.
export function isRightToLeft(text: string): boolean {
  const letter = /\p{L}/u.exec(text);
  return Boolean(letter && RTL_LETTER.test(letter[0]));
}

// Fetched once a page, when a PDF first needs it; a failed fetch is tried
// again next time.
let pdfFont: Promise<ArrayBuffer> | null = null;
export function fetchPdfFont(): Promise<ArrayBuffer> {
  pdfFont ??= fetch(PDF_FONT_URL).then((response) => {
    if (!response.ok) throw new Error(`The PDF font didn't load (HTTP ${response.status}).`);
    return response.arrayBuffer();
  });
  pdfFont.catch(() => {
    pdfFont = null;
  });
  return pdfFont;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

type JsPdf = import("jspdf").jsPDF;
type TextPayload = { text: unknown; options?: Record<string, unknown> };
type FontMetadata = { characterToGlyph(code: number): number };

function textOf(text: unknown): string {
  if (typeof text === "string") return text;
  if (Array.isArray(text)) return text.map((item) => textOf(Array.isArray(item) ? item[0] : item)).join("\n");
  return "";
}

// jsPDF reorders right-to-left text as if it were already in display order,
// which reverses a Hebrew line's numbers and leaves its words backwards.
// Text is in the order it was typed: ask for display order, in the
// direction of the text's first letter, or the one the call names
// (isInputRtl).
function drawInDisplayOrder(doc: JsPdf) {
  const events = (doc.internal as unknown as { events: { subscribe(topic: string, fn: (payload: TextPayload) => void): void } })
    .events;
  events.subscribe("preProcessText", (payload) => {
    payload.options = {
      ...payload.options,
      isInputVisual: false,
      isOutputVisual: true,
      isInputRtl: typeof payload.options?.isInputRtl === "boolean" ? payload.options.isInputRtl : isRightToLeft(textOf(payload.text)),
      isOutputRtl: false,
      isSymmetricSwapping: true,
    };
  });
}

// The characters of `texts` that the Unicode font has no glyph for, after
// Arabic letters take their joined forms, as jsPDF draws them.
function missingGlyphs(doc: JsPdf, texts: Iterable<string>): string[] {
  const metadata = (doc.getFont() as unknown as { metadata: FontMetadata }).metadata;
  const shape = (doc as unknown as { processArabic(text: string): string }).processArabic;
  const seen = new Set<string>();
  const missing: string[] = [];
  const check = (text: string) => {
    for (const char of text) {
      if (seen.has(char)) continue;
      seen.add(char);
      if (char !== "\n" && !metadata.characterToGlyph(char.codePointAt(0)!)) missing.push(char);
    }
  };
  for (const text of texts) {
    if (BUILT_IN_TEXT.test(text)) continue;
    check(text);
    if (/[\u0600-\u06ff]/.test(text)) check(shape(text));
  }
  return missing;
}

// What a PDF can't show, and what to do instead (`advice`, a sentence).
export function unsupportedScriptMessage(missing: string[], advice: string): string {
  const shown = missing.slice(0, 6).map((char) => `“${char}”`).join(", ");
  return `The PDF can't show ${shown}${missing.length > 6 ? " and more" : ""}: its font covers Latin, Greek, Cyrillic, Hebrew and Arabic, but not Chinese, Japanese, Korean, Indic or Thai text or emoji.${advice ? ` ${advice}` : ""}`;
}

export class UnsupportedScriptError extends Error {
  readonly missing: string[];
  constructor(missing: string[], advice: string) {
    super(unsupportedScriptMessage(missing, advice));
    this.name = "UnsupportedScriptError";
    this.missing = missing;
  }
}

// Embeds the Unicode font in `doc` (once, as one style: a second style, even
// of the same file, would embed it again), makes it the current font, and
// draws right-to-left text in display order. Throws UnsupportedScriptError,
// with `advice`, when any of `texts` has a character it can't show. Returns
// the font's name for setFont.
export function embedUnicodeFont(doc: JsPdf, fontBytes: ArrayBuffer, texts: Iterable<string>, advice: string): string {
  doc.addFileToVFS(`${PDF_FONT}.ttf`, toBase64(fontBytes));
  doc.addFont(`${PDF_FONT}.ttf`, PDF_FONT, "normal");
  doc.setFont(PDF_FONT, "normal");
  const missing = missingGlyphs(doc, texts);
  if (missing.length) throw new UnsupportedScriptError(missing, advice);
  drawInDisplayOrder(doc);
  return PDF_FONT;
}

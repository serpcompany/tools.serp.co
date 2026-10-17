// The Unicode font jsPDF writes text outside Windows-1252 in (#249), shared by
// the table PDFs (table-outputs.ts) and the text and XML PDFs (text-pdf.ts,
// #283). jsPDF's built-in fonts draw Windows-1252 only; anything else is
// drawn in DejaVu Sans, self-hosted and fetched only when a PDF needs it.
// Text the font has no glyph for, or that needs shaping jsPDF doesn't do, is
// refused, never drawn as empty boxes or unjoined letters.

export const PDF_FONT_URL = "/vendor/fonts/dejavu/DejaVuSans.ttf";
const PDF_FONT = "DejaVuSans";

// Text jsPDF's built-in fonts draw: Latin-1 and the rest of Windows-1252
// (their WinAnsiEncoding). Anything else needs the Unicode font.
const BUILT_IN_TEXT = /^[\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;
const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;

export function isBuiltInText(text: string): boolean {
  return BUILT_IN_TEXT.test(text);
}

// The zero-width non-joiner and joiner: kept for the Unicode font, where they
// part or join a word's letters (shapeArabic) and have glyphs, and dropped
// from text in a built-in font, which has neither.
const JOINERS = /\u200c|\u200d/g;
export const withoutJoiners = (text: string) => text.replace(JOINERS, "");

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

// ------------------------------------------------------------- Arabic --

// jsPDF draws an Arabic letter in the form its two neighbours call for
// (isolated, final, initial or medial: its processArabic, run on every text
// it draws), but takes every character of the Arabic blocks for a letter
// that joins on both sides, a comma, a digit, a vowel mark or a tatweel too,
// and anything else for a break, a zero-width joiner too. So a word before
// an Arabic comma would end in an initial form, and a vowel mark would part
// the letters around it. shapeArabic picks the forms by Unicode's joining
// rules instead, from jsPDF's own table, before jsPDF sees the text: jsPDF
// then leaves the forms as they are and only joins lam and alef into one.
type ArabicParser = {
  isInArabicSubstitutionA(letter: string): boolean;
  arabicLetterHasFinalForm(letter: string): boolean;
  arabicLetterHasMedialForm(letter: string): boolean;
};
type JsPdfArabic = { processArabic(text: string): string; __arabicParser__: ArabicParser };

// The characters jsPDF counts as Arabic letters, less the presentation
// forms: text without them has nothing to shape.
const ARABIC_BLOCKS = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;
const ZWNJ = "\u200c";
const ZWJ = "\u200d";
const TATWEEL = "\u0640";
const HIGH_HAMZA = "\u0674";
const BEH = "\u0628";
const LAM = "\u0644";
const ALEFS = new Set(["\u0622", "\u0623", "\u0625", "\u0627"]);
// Alef, lam, lam and heh, which jsPDF would join into the one letter U+FDF2
// the font doesn't have; a zero-width joiner between the last two keeps them
// four letters, joined as they are.
const ALLAH = "\ufe8d\ufedf\ufee0\ufeea";
const ALLAH_AS_LETTERS = "\ufe8d\ufedf\ufee0\u200d\ufeea";

// How a character joins its neighbours (Unicode's joining types): on both
// sides (D), to the letter before it only (R), not at all (U), or as a mark
// the letters around it join across (T). A zero-width joiner and a tatweel
// join on both sides and keep their own shape (C).
type Joining = "D" | "R" | "U" | "T" | "C";
const MARK = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
const JOINS_NEXT = new Set<Joining>(["D", "C"]);
const JOINS_PREVIOUS = new Set<Joining>(["D", "R", "C"]);

// Each character's, once: jsPDF's table is the same for every PDF.
const JOINING = new Map<string, Joining>();
function joining(parser: ArabicParser, char: string): Joining {
  let type = JOINING.get(char);
  if (!type) {
    if (char === ZWJ || char === TATWEEL) type = "C";
    else if (char === ZWNJ) type = "U";
    else if (parser.isInArabicSubstitutionA(char)) {
      type = parser.arabicLetterHasMedialForm(char) ? "D" : parser.arabicLetterHasFinalForm(char) ? "R" : "U";
    } else type = MARK.test(char) ? "T" : "U";
    JOINING.set(char, type);
  }
  return type;
}

// A letter's isolated, final, initial and medial forms, as jsPDF draws it
// alone, after a beh, before one and between two.
const FORMS = new Map<string, string[]>();
function formsOf(doc: JsPdfArabic, letter: string): string[] {
  let forms = FORMS.get(letter);
  if (!forms) {
    const shape = (text: string) => [...doc.processArabic(text)];
    forms = [shape(letter)[0]!, shape(BEH + letter)[1]!, shape(letter + BEH)[0]!, shape(BEH + letter + BEH)[1]!];
    FORMS.set(letter, forms);
  }
  return forms;
}

// `text` with its Arabic letters in the forms their neighbours call for:
// joined across vowel marks, a tatweel and a zero-width joiner, and apart at
// a zero-width non-joiner, punctuation, digits and anything else. Every PDF
// in the Unicode font draws its text as this returns it. It reads a line a
// UTF-16 unit at a time: the Arabic blocks are all in the first plane, and
// the halves of any other character join nothing.
export function shapeArabic(doc: JsPdf, text: string): string {
  if (!ARABIC_BLOCKS.test(text)) return text;
  const arabic = doc as unknown as JsPdfArabic;
  const parser = arabic.__arabicParser__;
  // Composed, so a vowel mark comes before a shadda (Unicode's order) and
  // jsPDF doesn't join the two into one of its ligatures the font lacks.
  const source = text.normalize("NFC");
  const typeAt = (index: number) => joining(parser, source[index]!);
  let shaped = "";
  // Whether the last character that isn't a mark joins the next letter.
  let joinsNext = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const type = typeAt(index);
    if (type === "T") {
      shaped += char;
      continue;
    }
    if (parser.isInArabicSubstitutionA(char)) {
      let next = index + 1;
      while (next < source.length && typeAt(next) === "T") next += 1;
      const before = joinsNext && type !== "U";
      const after = type === "D" && next < source.length && JOINS_PREVIOUS.has(typeAt(next));
      const form = formsOf(arabic, char)[before ? (after ? 3 : 1) : after ? 2 : 0]!;
      if (char === LAM && after && ALEFS.has(source[next]!)) {
        // Lam, its marks, alef: the marks go after the alef, so jsPDF
        // joins lam and alef into one letter, as they are written.
        shaped += form + formsOf(arabic, source[next]!)[1] + source.slice(index + 1, next);
        index = next;
        joinsNext = false;
        continue;
      }
      shaped += form;
    } else {
      shaped += char;
    }
    joinsNext = JOINS_NEXT.has(type);
  }
  return shaped.replaceAll(ALLAH, ALLAH_AS_LETTERS);
}

// ------------------------------------------------------------- coverage --

// Letters the font has that jsPDF can't set: Lao's vowel and tone marks need
// placing and N'Ko's letters joining, which jsPDF doesn't do, and it has no
// joined forms for the Arabic-script letters missing from its table (most of
// those Kurdish, Pashto, Sindhi and Uyghur add), bar the high hamza, which
// doesn't join.
const NEEDS_SHAPING = /[\u07c0-\u07ff\u0e80-\u0eff]/;
const LETTER = /^\p{L}$/u;

// The characters of `texts` the PDF can't show: those jsPDF can't set, and
// those the font has no glyph for in the forms jsPDF draws them in.
function unsupportedCharacters(doc: JsPdf, texts: Iterable<string>): string[] {
  const metadata = (doc.getFont() as unknown as { metadata: FontMetadata }).metadata;
  const arabic = doc as unknown as JsPdfArabic;
  const parser = arabic.__arabicParser__;
  const drawn = (char: string) => char === "\n" || Boolean(metadata.characterToGlyph(char.codePointAt(0)!));
  const shown = (char: string) => {
    if (parser.isInArabicSubstitutionA(char)) {
      const forms = formsOf(arabic, char);
      const type = joining(parser, char);
      return forms.slice(0, type === "D" ? 4 : type === "R" ? 2 : 1).every(drawn);
    }
    if (NEEDS_SHAPING.test(char)) return false;
    if (ARABIC_BLOCKS.test(char) && LETTER.test(char) && char !== TATWEEL && char !== HIGH_HAMZA) return false;
    return drawn(char);
  };
  const seen = new Set<string>();
  const missing: string[] = [];
  const check = (text: string) => {
    for (const char of text) {
      if (seen.has(char)) continue;
      seen.add(char);
      if (!shown(char)) missing.push(char);
    }
  };
  for (const text of texts) {
    if (BUILT_IN_TEXT.test(text)) continue;
    check(text);
    // The letters jsPDF joins into one, such as lam and alef.
    if (ARABIC_BLOCKS.test(text)) check(arabic.processArabic(shapeArabic(doc, text)));
  }
  return missing;
}

// What a PDF can't show, and what to do instead (`advice`, a sentence). A
// mark is shown on a dotted circle, as it would sit on a letter.
export function unsupportedScriptMessage(missing: string[], advice: string): string {
  const shown = missing
    .slice(0, 6)
    .map((char) => `“${/^\p{M}/u.test(char) ? `\u25cc${char}` : char}”`)
    .join(", ");
  return `The PDF can't show ${shown}${missing.length > 6 ? " and more" : ""}: its font covers Latin, Greek, Cyrillic, Hebrew, Arabic and Persian, but not Chinese, Japanese, Korean, Indic, Thai, Lao or N'Ko text, some letters of Urdu, Kurdish, Pashto and other languages written in Arabic script, or emoji.${advice ? ` ${advice}` : ""}`;
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
// the font's name for setFont. Each text is then drawn as shapeArabic
// returns it.
export function embedUnicodeFont(doc: JsPdf, fontBytes: ArrayBuffer, texts: Iterable<string>, advice: string): string {
  doc.addFileToVFS(`${PDF_FONT}.ttf`, toBase64(fontBytes));
  doc.addFont(`${PDF_FONT}.ttf`, PDF_FONT, "normal");
  doc.setFont(PDF_FONT, "normal");
  const missing = unsupportedCharacters(doc, texts);
  if (missing.length) throw new UnsupportedScriptError(missing, advice);
  drawInDisplayOrder(doc);
  return PDF_FONT;
}

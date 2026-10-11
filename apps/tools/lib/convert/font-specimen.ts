// A TrueType or OpenType font converted to an image is a specimen of it: the
// font's name, its letters and digits, and a pangram at five sizes, in black
// on white, drawn with the font by ImageMagick (FreeType). The image is as
// wide as the longest line needs (up to MAX_WIDTH) and grey, so a PNG or LZW
// TIFF of it is tens of kilobytes. SVG output wraps this image (encode.ts):
// it isn't the font's outlines.
import type { IMagickImage } from "@imagemagick/magick-wasm";

type MagickModule = typeof import("@imagemagick/magick-wasm");

export const PANGRAM = "The quick brown fox jumps over the lazy dog";

const MARGIN = 40;
const MAX_WIDTH = 2400;
const MIN_WIDTH = 400;
const NAME_MAX_LENGTH = 64;
// The name ImageMagick knows the font by: Magick.addFont writes /fonts/<name>.
// Each specimen overwrites the last one's font.
const FONT_FILE = "specimen-font";

// The lines of the specimen, top to bottom, with their size in pixels.
export function specimenLines(name: string): { text: string; size: number }[] {
  return [
    { text: name, size: 40 },
    { text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", size: 28 },
    { text: "abcdefghijklmnopqrstuvwxyz", size: 28 },
    { text: "0123456789 .,:;!?&()", size: 28 },
    ...[16, 24, 32, 48, 64].map((size) => ({ text: PANGRAM, size })),
  ];
}

// The font's full name (name ID 4), or its family name (ID 1), from its
// `name` table; null when it has neither. In a collection (TTC), the first
// font's. Windows and Unicode names are UTF-16BE; Mac Roman ones are read as
// Latin-1, which matches it for ASCII.
export function fontName(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at);
  const u32 = (at: number) => view.getUint32(at);
  try {
    const font = u32(0) === 0x74746366 /* ttcf */ ? u32(12) : 0;
    const tables = u16(font + 4);
    let name = -1;
    for (let index = 0; index < tables; index += 1) {
      const record = font + 12 + index * 16;
      if (u32(record) === 0x6e616d65 /* name */) name = u32(record + 8);
    }
    if (name < 0) return null;
    const count = u16(name + 2);
    const strings = name + u16(name + 4);
    let best: { rank: number; text: string } | null = null;
    for (let index = 0; index < count; index += 1) {
      const record = name + 6 + index * 12;
      const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((at) => u16(record + at)) as [
        number, number, number, number, number, number,
      ];
      if (id !== 4 && id !== 1) continue;
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      const macRoman = platform === 1 && encoding === 0;
      if (!unicode && !macRoman) continue;
      // Full name before family name; then English Windows, any Windows or
      // Unicode, Mac Roman.
      const rank =
        (id === 4 ? 0 : 10) + (platform === 3 && language === 0x409 ? 0 : unicode ? 1 : 2);
      if (best && best.rank <= rank) continue;
      const raw = bytes.subarray(strings + offset, strings + offset + length);
      const text = new TextDecoder(unicode ? "utf-16be" : "latin1").decode(raw);
      best = { rank, text };
    }
    const cleaned = best?.text.replace(/\p{Cc}/gu, "").trim().slice(0, NAME_MAX_LENGTH);
    return cleaned || null;
  } catch {
    // A table offset past the end of the file: no name.
    return null;
  }
}

// Draws the specimen of `bytes`, a TTF or OTF file, and hands it to `handle`.
export function drawFontSpecimen<T>(
  magick: MagickModule,
  bytes: Uint8Array,
  from: string,
  handle: (image: IMagickImage) => T,
): T {
  magick.Magick.addFont(FONT_FILE, bytes);
  const measure = (text: string, size: number) => {
    try {
      return new magick.Drawables().font(FONT_FILE).fontPointSize(size).fontTypeMetrics(text);
    } catch {
      // FreeType's UnableToReadFont: not a font, or a damaged one.
      throw new Error(`This ${from.toUpperCase()} file isn't a font the converter can read.`);
    }
  };
  const lines = specimenLines(fontName(bytes) ?? `${from.toUpperCase()} font`).map((line) => {
    const metrics = measure(line.text, line.size);
    return {
      ...line,
      width: metrics?.textWidth ?? 0,
      ascent: metrics?.ascent || line.size,
      descent: -(metrics?.descent ?? 0) || Math.round(line.size / 4),
    };
  });
  if (lines.every((line) => line.width === 0)) {
    throw new Error("This font has no letters the converter can draw.");
  }
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(Math.max(...lines.map((line) => line.width))) + 2 * MARGIN));
  const gap = (line: { size: number }) => Math.round(line.size * 0.4);
  const height =
    2 * MARGIN + lines.reduce((sum, line) => sum + Math.ceil(line.ascent + line.descent) + gap(line), 0) - gap(lines.at(-1)!);
  const image = magick.MagickImage.create(new magick.MagickColor("white"), width, height);
  try {
    const drawables = new magick.Drawables().font(FONT_FILE).fillColor(new magick.MagickColor("black"));
    let top = MARGIN;
    for (const line of lines) {
      drawables.fontPointSize(line.size).text(MARGIN, top + line.ascent, line.text);
      top += Math.ceil(line.ascent + line.descent) + gap(line);
    }
    drawables.draw(image);
    image.colorType = magick.ColorType.Grayscale;
    // LZW for a TIFF: 50 KB instead of about 1 MB. Other formats ignore it.
    image.settings.compression = magick.CompressionMethod.LZW;
    return handle(image);
  } finally {
    image.dispose();
  }
}

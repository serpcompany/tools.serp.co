// Checks that a converter's output really is the format the tool promised,
// from its first bytes. A tool that writes PNG bytes into a `.gif` download
// must count as a failure, not a success (issue #147).

type Signature = (bytes: Uint8Array, text: string) => boolean;

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

const startsWith = (...prefix: number[]): Signature => (bytes) =>
  prefix.every((byte, i) => bytes[i] === byte);

const startsWithText = (prefix: string): Signature => (bytes) =>
  ascii(bytes, 0, prefix.length) === prefix;

// ISO base media files (MP4, MOV, AVIF, HEIC...) carry "ftyp" at offset 4.
const isoBrand = (...brands: string[]): Signature => (bytes) =>
  ascii(bytes, 4, 8) === "ftyp" && (brands.length === 0 || brands.includes(ascii(bytes, 8, 12)));

const riff = (form: string): Signature => (bytes) =>
  ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === form;

const iff = (...forms: string[]): Signature => (bytes) =>
  ascii(bytes, 0, 4) === "FORM" && forms.includes(ascii(bytes, 8, 12));

const isMp3: Signature = (bytes) =>
  ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);

const isJpeg = startsWith(0xff, 0xd8, 0xff);
const isTiff: Signature = (bytes) => ["II*\0", "MM\0*"].includes(ascii(bytes, 0, 4));
const isMatroska = startsWith(0x1a, 0x45, 0xdf, 0xa3);
const isOgg = startsWithText("OggS");
const isIsoMedia = isoBrand();
// H.265 Annex B: a start code, then a parameter set, delimiter or SEI NAL unit.
const HEVC_FIRST_NAL_TYPES = new Set([32, 33, 34, 35, 39]); // VPS, SPS, PPS, AUD, prefix SEI
const isHevcAnnexB: Signature = (bytes) => {
  const start = startsWith(0, 0, 1)(bytes, "") ? 3 : startsWith(0, 0, 0, 1)(bytes, "") ? 4 : 0;
  const header = bytes[start] ?? 0x80;
  return start > 0 && (header & 0x80) === 0 && HEVC_FIRST_NAL_TYPES.has(header >> 1);
};
const isNetpbm = (...kinds: string[]): Signature => (bytes) =>
  bytes[0] === 0x50 && kinds.includes(String.fromCharCode(bytes[1] ?? 0));

// Only formats with a reliable signature. Anything else isn't checked.
const SIGNATURES: Record<string, Signature> = {
  png: startsWith(0x89, 0x50, 0x4e, 0x47),
  apng: startsWith(0x89, 0x50, 0x4e, 0x47),
  jpg: isJpeg,
  jpeg: isJpeg,
  jfif: isJpeg,
  jif: isJpeg,
  gif: startsWithText("GIF8"),
  webp: riff("WEBP"),
  bmp: startsWithText("BM"),
  tif: isTiff,
  tiff: isTiff,
  ico: startsWith(0x00, 0x00, 0x01, 0x00),
  // ImageMagick writes cursors with the icon type byte, which readers accept.
  cur: (bytes) =>
    startsWith(0x00, 0x00, 0x02, 0x00)(bytes, "") || startsWith(0x00, 0x00, 0x01, 0x00)(bytes, ""),
  psd: startsWithText("8BPS"),
  dds: startsWithText("DDS "),
  icns: startsWithText("icns"),
  ktx: startsWith(0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31),
  ktx2: startsWith(0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30),
  jxl: (bytes) =>
    startsWith(0xff, 0x0a)(bytes, "") ||
    startsWith(0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20)(bytes, ""),
  jp2: startsWith(0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20),
  avif: isoBrand("avif", "avis"),
  heic: isoBrand("heic", "heix", "heim", "heis", "mif1", "msf1"),
  heif: isoBrand("heic", "heix", "heim", "heis", "mif1", "msf1"),
  pbm: isNetpbm("1", "4"),
  pgm: isNetpbm("2", "5"),
  ppm: isNetpbm("3", "6"),
  pam: isNetpbm("7"),
  svg: (_bytes, text) => /<svg[\s>]/i.test(text),
  pdf: startsWithText("%PDF"),
  // Office Open XML: a ZIP whose entries include [Content_Types].xml.
  docx: (bytes) =>
    startsWith(0x50, 0x4b, 0x03, 0x04)(bytes, "") && ascii(bytes, 0, bytes.length).includes("[Content_Types].xml"),
  // Illustrator's PDF-compatible AI files are PDFs.
  ai: startsWithText("%PDF"),
  // Kodak Photo CD: the image pack header sits after 2048 bytes of padding.
  pcd: (bytes) => ascii(bytes, 2048, 2055) === "PCD_IPI",
  // A ZIP whose first entry is the stored "mimetype" file (the OCF rule).
  epub: (bytes) =>
    startsWith(0x50, 0x4b, 0x03, 0x04)(bytes, "") &&
    ascii(bytes, 30, 38) === "mimetype" &&
    ascii(bytes, 38, 58) === "application/epub+zip",
  mp3: isMp3,
  wav: riff("WAVE"),
  avi: riff("AVI "),
  ogg: isOgg,
  oga: isOgg,
  ogv: isOgg,
  opus: isOgg,
  flac: startsWithText("fLaC"),
  aiff: iff("AIFF", "AIFC"),
  aif: iff("AIFF", "AIFC"),
  aifc: iff("AIFF", "AIFC"),
  webm: isMatroska,
  mkv: isMatroska,
  mp4: isIsoMedia,
  m4a: isIsoMedia,
  m4v: isIsoMedia,
  m4r: isIsoMedia,
  mov: isIsoMedia,
  "3gp": isIsoMedia,
  "3g2": isIsoMedia,
  flv: startsWithText("FLV"),
  // AV1 in IVF, the container aomenc writes; .hevc is a raw H.265 stream.
  av1: (bytes) => ascii(bytes, 0, 4) === "DKIF" && ascii(bytes, 8, 12) === "AV01",
  hevc: isHevcAnnexB,
};

// Formats to name in telemetry when the output matches none of the expected one.
const DETECTABLE = ["png", "jpg", "gif", "webp", "bmp", "tiff", "pdf", "mp3", "wav", "ogg", "webm", "mp4"];

export type OutputFormatCheck =
  | { ok: true }
  | { ok: false; expected: string; detected: string };

export function checkOutputFormat(buffer: ArrayBuffer, to: string): OutputFormatCheck {
  const expected = to.toLowerCase();
  const signature = SIGNATURES[expected];
  if (!signature) return { ok: true };

  // 4 KB covers every signature, including PCD's at byte 2048.
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
  const text = expected === "svg" ? new TextDecoder().decode(bytes) : "";
  if (signature(bytes, text)) return { ok: true };

  const detected = DETECTABLE.find((format) => SIGNATURES[format]?.(bytes, "")) ?? "unknown";
  return { ok: false, expected, detected };
}

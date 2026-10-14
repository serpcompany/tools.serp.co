// The image format a file's first bytes say it is, whatever its name. Image
// to PDF (image-pdf-inputs.ts) trusts a few of them over the extension; BIN
// to JPG, JPEG and PNG (bin-image.ts) read every format here, since a .bin
// name says nothing.

// Enough for every signature below: a Photo CD's is 2 KB in, an SVG's root
// element can follow a long prolog, and bin-image.ts looks again 128 bytes in,
// past a MacBinary header.
export const IMAGE_SIGNATURE_BYTES = 4096;

// Every format the site's image engines read (decode.ts, magickBrowser.ts)
// that has no signature to find it by, and why. bin-image.test.mjs fails when
// an engine reads a format that is neither found by imageFormatFromBytes nor
// listed here.
export const NO_SIGNATURE: Readonly<Record<string, string>> = {
  mac: "a MacPaint file starts with a version number and patterns, nothing fixed; one in a MacBinary wrapper is found by its PNTG type (bin-image.ts)",
  ttf: "a font, drawn as a specimen, not a picture",
  otf: "a font, drawn as a specimen, not a picture",
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  return bytes.length >= at + prefix.length && prefix.every((byte, index) => bytes[at + index] === byte);
}

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0);
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

// Brands of an ISO media file (HEIF, AVIF, CR3): the major brand, then the
// compatible ones.
function ftypBrands(head: Uint8Array): string[] {
  if (head.length < 16 || ascii(head, 4, 4) !== "ftyp") return [];
  const size = Math.min(uint32be(head, 0), head.length);
  const brands = [ascii(head, 8, 4)];
  for (let offset = 16; offset + 4 <= size; offset += 4) brands.push(ascii(head, offset, 4));
  return brands;
}

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);
// The sizes a BMP's second header has had, from OS/2 1.x (12) to V5 (124).
const BMP_INFO_SIZES = new Set([12, 16, 40, 52, 56, 64, 108, 124]);

// An icon (type 1) or cursor (type 2) directory: reserved 0, the type, then
// at least one entry whose reserved byte is 0. Four bytes alone would match
// an MPEG stream's start code. An icon's entry has 0 or 1 colour planes where
// a cursor's has its hotspot; a cursor's first image starts after the
// directory, and has a size.
function isIcon(head: Uint8Array): boolean {
  if (!startsWith(head, [0, 0, 1, 0]) || head.length < 14) return false;
  const count = uint16le(head, 4);
  const planes = uint16le(head, 10);
  return count > 0 && head[9] === 0 && planes <= 1;
}

function isCursor(head: Uint8Array): boolean {
  if (!startsWith(head, [0, 0, 2, 0]) || head.length < 22) return false;
  const count = uint16le(head, 4);
  return count > 0 && head[9] === 0 && uint32le(head, 14) > 0 && uint32le(head, 18) >= 6 + 16 * count;
}

// A TIFF's first directory (IFD0), as far as `head` holds it: each tag's
// type, count, and where its value (or the offset of its value) is.
type TiffDirectory = {
  tags: Map<number, { type: number; count: number; at: number }>;
  u16: (at: number) => number;
  u32: (at: number) => number;
};

function tiffDirectory(head: Uint8Array): TiffDirectory | null {
  const little = head[0] === 0x49;
  const u16 = (at: number) => (little ? uint16le(head, at) : (head[at]! << 8) | head[at + 1]!);
  const u32 = (at: number) => (little ? uint32le(head, at) : uint32be(head, at));
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > head.length) return null;
  const tags: TiffDirectory["tags"] = new Map();
  const count = u16(ifd);
  for (let entry = ifd + 2; entry + 12 <= head.length && tags.size < count; entry += 12) {
    tags.set(u16(entry), { type: u16(entry + 2), count: u32(entry + 4), at: entry + 8 });
  }
  return { tags, u16, u32 };
}

// Camera RAW makers whose RAW files are TIFF underneath, and the format
// ImageMagick's RAW decoder (LibRaw) reads them as.
const TIFF_RAW_MAKERS: readonly [RegExp, string][] = [
  [/^NIKON/i, "nef"],
  [/^SONY/i, "arw"],
  [/^Canon/i, "cr2"],
];

// A TIFF, or a camera RAW file that is TIFF underneath. Read as a TIFF, a
// RAW file gives only its small preview, or nothing: a Sony ARW's first
// directory has no image size. A RAW file's first directory is a preview
// (NewSubfileType 1) or points to the full image (SubIFDs); a DNG says so
// (DNGVersion), and a Canon CR2 says "CR" after the header. A TIFF from a
// scanner or a photo editor is none of these.
function tiffFormat(head: Uint8Array): string {
  if (ascii(head, 8, 2) === "CR" && head[10] === 2) return "cr2";
  const directory = tiffDirectory(head);
  if (!directory) return "tiff";
  const { tags, u16, u32 } = directory;
  if (tags.has(0xc612)) return "dng";
  const subfile = tags.get(0x00fe);
  const preview = subfile !== undefined && (subfile.type === 3 ? u16(subfile.at) : u32(subfile.at)) === 1;
  const make = tags.get(0x010f);
  if (!make || make.type !== 2 || !(preview || tags.has(0x014a))) return "tiff";
  const maker = ascii(head, make.count <= 4 ? make.at : u32(make.at), Math.min(make.count, 32));
  return TIFF_RAW_MAKERS.find(([pattern]) => pattern.test(maker))?.[1] ?? "tiff";
}

// Netpbm: "P1" to "P7", whitespace, then the width (P1 to P6) or a header
// line such as WIDTH (P7, PAM). Comments start with "#".
const NETPBM: Record<string, string> = { "1": "pbm", "4": "pbm", "2": "pgm", "5": "pgm", "3": "ppm", "6": "ppm", "7": "pam" };

function netpbmFormat(head: Uint8Array): string | null {
  if (head[0] !== 0x50) return null;
  const format = NETPBM[String.fromCharCode(head[1] ?? 0)];
  if (!format || !/\s/.test(String.fromCharCode(head[2] ?? 0))) return null;
  const rest = ascii(head, 2, 256).replace(/^(\s|#[^\n]*\n)+/, "");
  return (format === "pam" ? /^[A-Z]/ : /^\d/).test(rest) ? format : null;
}

// ZSoft PCX: 0x0A, a version, RLE or none, 1, 2, 4 or 8 bits per plane, a
// reserved 0 at 64, then 1 to 4 planes.
function isPcx(head: Uint8Array): boolean {
  return (
    head.length >= 66 &&
    head[0] === 0x0a &&
    [0, 2, 3, 4, 5].includes(head[1]!) &&
    head[2]! <= 1 &&
    [1, 2, 4, 8].includes(head[3]!) &&
    uint16le(head, 8) >= uint16le(head, 4) &&
    uint16le(head, 10) >= uint16le(head, 6) &&
    head[64] === 0 &&
    head[65]! >= 1 &&
    head[65]! <= 4
  );
}

// An SVG: text whose root element is <svg>, after an optional byte order
// mark, XML declaration, comments and doctype.
function isSvg(head: Uint8Array): boolean {
  let text = ascii(head, 0, Math.min(head.length, IMAGE_SIGNATURE_BYTES)).replace(/^\xef\xbb\xbf/, "");
  for (;;) {
    text = text.trimStart();
    const end = prologEnd(text);
    if (end === null) return /^<svg[\s>/]/.test(text);
    // A prolog longer than the bytes read.
    if (end < 0) return false;
    text = text.slice(end);
  }
}

// Where the XML declaration, processing instruction, comment or doctype that
// `text` starts with ends: null when it starts with none of them, -1 when
// `text` ends first. A doctype may hold an internal subset in [...].
function prologEnd(text: string): number | null {
  const after = (marker: string, from = 0) => {
    const at = text.indexOf(marker, from);
    return at < 0 ? -1 : at + marker.length;
  };
  if (text.startsWith("<?")) return after("?>");
  if (text.startsWith("<!--")) return after("-->");
  if (!text.startsWith("<!DOCTYPE")) return null;
  const subset = text.indexOf("[");
  const close = text.indexOf(">");
  if (subset < 0 || (close >= 0 && close < subset)) return close < 0 ? -1 : close + 1;
  const subsetEnd = after("]", subset);
  return subsetEnd < 0 ? -1 : after(">", subsetEnd);
}

// Truevision TGA has no signature at its start, and only version 2 files
// have one at their end. Its header is checked field by field instead: a
// colour map type, an image type that matches it, a size, a pixel depth,
// and a file long enough for the pixels (a run-length packet holds at most
// 128 of them). `size`: the whole file's.
function isTga(head: Uint8Array, size: number): boolean {
  if (head.length < 18) return false;
  const [idLength, mapType, imageType] = [head[0]!, head[1]!, head[2]!];
  const mapLength = uint16le(head, 5);
  const mapDepth = head[7]!;
  const [width, height, depth, descriptor] = [uint16le(head, 12), uint16le(head, 14), head[16]!, head[17]!];
  const mapped = imageType === 1 || imageType === 9;
  if (mapType > 1 || ![1, 2, 3, 9, 10, 11].includes(imageType) || mapped !== (mapType === 1)) return false;
  if (mapType === 0 ? ascii(head, 3, 5) !== "\0\0\0\0\0" : mapLength === 0 || ![15, 16, 24, 32].includes(mapDepth)) return false;
  if (!width || !height || ![8, 15, 16, 24, 32].includes(depth) || descriptor & 0xc0) return false;
  const pixelBytes = Math.ceil(depth / 8);
  const before = 18 + idLength + Math.ceil((mapLength * mapDepth) / 8);
  const pixels = width * height;
  const least = imageType >= 9 ? Math.ceil(pixels / 128) * (1 + pixelBytes) : pixels * pixelBytes;
  return size >= before + least;
}

// The format, as the converters name it, or null when the bytes start like
// no image the site's engines read. `size`: the whole file's, when `head` is
// only its start; TGA is told apart by it.
export function imageFormatFromBytes(head: Uint8Array, size = head.length): string | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (head.length >= 6 && (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")) return "gif";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "webp";
  const brands = ftypBrands(head);
  if (brands.includes("crx ")) return "cr3";
  if (brands.includes("avif") || brands.includes("avis")) return "avif";
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "heic";
  if (head.length >= 18 && ascii(head, 0, 2) === "BM" && BMP_INFO_SIZES.has(uint32le(head, 14))) return "bmp";
  // Camera RAW with a header of its own: Olympus, Panasonic, Canon's older
  // CRW, Fujifilm.
  if (head.length >= 8 && ["IIRO", "IIRS", "MMOR"].includes(ascii(head, 0, 4))) return "orf";
  if (head.length >= 8 && ascii(head, 0, 4) === "IIU\0") return "rw2";
  if (head.length >= 14 && ascii(head, 0, 14) === "II\x1a\0\0\0HEAPCCDR") return "crw";
  if (head.length >= 16 && ascii(head, 0, 16) === "FUJIFILMCCD-RAW ") return "raf";
  if (head.length >= 8 && ["II*\0", "MM\0*"].includes(ascii(head, 0, 4))) return tiffFormat(head);
  if (isIcon(head)) return "ico";
  if (isCursor(head)) return "cur";
  if (head.length >= 6 && ascii(head, 0, 4) === "8BPS" && head[4] === 0 && (head[5] === 1 || head[5] === 2)) return "psd";
  if (startsWith(head, [0xff, 0x0a]) || startsWith(head, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) {
    return "jxl";
  }
  if (startsWith(head, [0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return "jp2";
  if (startsWith(head, [0x76, 0x2f, 0x31, 0x01])) return "exr";
  if (head.length >= 6 && (ascii(head, 0, 10) === "#?RADIANCE" || ascii(head, 0, 6) === "#?RGBE")) return "hdr";
  if (head.length >= 9 && ascii(head, 0, 9) === "gimp xcf ") return "xcf";
  if (head.length >= 8 && ascii(head, 0, 4) === "DDS " && uint32le(head, 4) === 124) return "dds";
  if (head.length >= 8 && ascii(head, 0, 4) === "icns") return "icns";
  if (startsWith(head, [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])) return "ktx";
  if (startsWith(head, [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])) return "ktx2";
  const netpbm = netpbmFormat(head);
  if (netpbm) return netpbm;
  if (isPcx(head)) return "pcx";
  if (head.length >= 9 && ascii(head, 0, 9) === "/* XPM */") return "xpm";
  // WordPerfect Graphics: WordPerfect's header, file type 0x16. A
  // WordPerfect document has the same header with another type.
  if (head.length >= 10 && ascii(head, 0, 4) === "\xffWPC" && head[9] === 0x16) return "wpg";
  if (head.length >= 5 && ascii(head, 0, 4) === "SFW9") return "sfw";
  // Kodak Photo CD: an image pack's header is 2 KB in; an overview pack's is
  // at the start.
  if ((head.length >= 2055 && ascii(head, 2048, 7) === "PCD_IPI") || ascii(head, 0, 7) === "PCD_OPA") return "pcd";
  if (isSvg(head)) return "svg";
  if (isTga(head, size)) return "tga";
  return null;
}

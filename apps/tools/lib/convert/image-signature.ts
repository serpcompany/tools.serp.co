// The image format a file's first bytes say it is, whatever its name. Image
// to PDF (image-pdf-inputs.ts) trusts a few of them over the extension; BIN
// to JPG, JPEG and PNG (bin-image.ts) read every format here, since a .bin
// name says nothing.

// Enough for every signature below.
export const IMAGE_SIGNATURE_BYTES = 64;

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0);
}

// Brands of an ISO media file (HEIF, AVIF, CR3): the major brand, then the
// compatible ones.
function ftypBrands(head: Uint8Array): string[] {
  if (head.length < 16 || ascii(head, 4, 4) !== "ftyp") return [];
  const size = Math.min(((head[0]! << 24) | (head[1]! << 16) | (head[2]! << 8) | head[3]!) >>> 0, head.length);
  const brands = [ascii(head, 8, 4)];
  for (let offset = 16; offset + 4 <= size; offset += 4) brands.push(ascii(head, offset, 4));
  return brands;
}

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);
// The sizes a BMP's second header has had, from OS/2 1.x (12) to V5 (124).
const BMP_INFO_SIZES = new Set([12, 16, 40, 52, 56, 64, 108, 124]);

// An icon directory: reserved 0, type 1, then at least one entry whose
// reserved byte is 0 and whose colour planes are 0 or 1. Four bytes alone
// would match an MPEG stream's start code.
function isIcon(head: Uint8Array): boolean {
  if (!startsWith(head, [0, 0, 1, 0]) || head.length < 14) return false;
  const count = head[4]! | (head[5]! << 8);
  const planes = head[10]! | (head[11]! << 8);
  return count > 0 && head[9] === 0 && planes <= 1;
}

// The format, as the converters name it, or null when the bytes start like
// no image the site's engines read. Camera RAW files that are TIFF
// underneath (NEF, CR2, DNG, ARW) start like a TIFF too.
export function imageFormatFromBytes(head: Uint8Array): string | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (head.length >= 6 && (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")) return "gif";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "webp";
  const brands = ftypBrands(head);
  if (brands.includes("avif") || brands.includes("avis")) return "avif";
  if (brands.some((brand) => HEIF_BRANDS.has(brand)) && !brands.includes("crx ")) return "heic";
  if (head.length >= 18 && ascii(head, 0, 2) === "BM" && BMP_INFO_SIZES.has(uint32le(head, 14))) return "bmp";
  if (head.length >= 8 && ["II*\0", "MM\0*"].includes(ascii(head, 0, 4))) return "tiff";
  if (isIcon(head)) return "ico";
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
  return null;
}

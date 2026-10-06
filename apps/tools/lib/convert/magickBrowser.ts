// ImageMagick (WASM) in the browser, for inputs the browser can't decode:
// camera RAW, PSD, TGA, DDS, TIFF, XCF. Loads the 14 MB wasm on first use.
import type { MagickFormat as MagickFormatType } from "@imagemagick/magick-wasm";

const WASM_URL = "/vendor/imagemagick/magick.wasm";

type MagickModule = typeof import("@imagemagick/magick-wasm");

let magickReady: Promise<MagickModule> | null = null;

function loadMagick(): Promise<MagickModule> {
  if (!magickReady) {
    magickReady = (async () => {
      const magick = await import("@imagemagick/magick-wasm");
      const response = await fetch(WASM_URL);
      if (!response.ok) {
        throw new Error(`Couldn't load the image converter (${response.status}).`);
      }
      await magick.initializeImageMagick(new Uint8Array(await response.arrayBuffer()));
      return magick;
    })().catch((error) => {
      magickReady = null;
      throw error;
    });
  }
  return magickReady;
}

// Lowercase extension -> MagickFormat, for the formats ImageMagick can read
// or write in this WASM build (no Ghostscript, no HEIC encoder).
function magickFormat(magick: MagickModule, ext: string): MagickFormatType | undefined {
  const aliases: Record<string, string> = { jpg: "jpeg", jfif: "jpeg", jif: "jpeg", tif: "tiff" };
  const name = aliases[ext] ?? ext;
  const key = Object.keys(magick.MagickFormat).find((k) => k.toLowerCase() === name);
  return key ? magick.MagickFormat[key as keyof typeof magick.MagickFormat] : undefined;
}

// Formats the browser can't decode that ImageMagick reads: camera RAW and
// layered or legacy image formats.
export const MAGICK_BROWSER_INPUTS = new Set([
  "arw", "cr2", "cr3", "crw", "dng", "nef", "orf", "raf", "rw2",
  "dds", "psd", "tga", "tif", "tiff", "xcf",
]);

// Formats ImageMagick writes that a canvas can't. Camera RAW, HEIC, ICNS and
// KTX can't be written by any engine we have.
export const MAGICK_BROWSER_OUTPUTS = new Set([
  "bmp", "cur", "dds", "eps", "exr", "gif", "hdr", "ico", "jp2", "jxl", "pam",
  "pbm", "pcx", "pgm", "ppm", "psd", "rgb", "tga", "tif", "tiff", "wbmp",
  "xbm", "xpm", "avif", "jpeg", "jpg", "png", "webp",
]);

const MIME_TYPES: Record<string, string> = {
  avif: "image/avif", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon",
  cur: "image/x-icon", jp2: "image/jp2", jpeg: "image/jpeg", jpg: "image/jpeg",
  jxl: "image/jxl", png: "image/png", psd: "image/vnd.adobe.photoshop",
  tif: "image/tiff", tiff: "image/tiff", webp: "image/webp", eps: "application/postscript",
};

export function mimeTypeFor(ext: string) {
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// Converts `from` to `to` when ImageMagick can write `to`; otherwise to PNG,
// for the caller to re-encode. Returns the bytes and the format written.
export async function convertWithMagickInBrowser(
  buf: ArrayBuffer,
  from: string,
  to: string,
): Promise<{ buffer: ArrayBuffer; format: string }> {
  const magick = await loadMagick();
  const source = magickFormat(magick, from);
  if (!source || !MAGICK_BROWSER_INPUTS.has(from)) {
    throw new Error(`${from.toUpperCase()} isn't supported by the image converter.`);
  }
  const format = MAGICK_BROWSER_OUTPUTS.has(to) ? to : "png";
  const target = magickFormat(magick, format)!;
  const bytes = magick.ImageMagick.read(new Uint8Array(buf), source, (image) =>
    image.write(target, (data) => data.slice()),
  );
  return { buffer: bytes.buffer as ArrayBuffer, format };
}

// Re-encodes a PNG into a format a canvas can't produce.
export async function encodePngWithMagick(png: ArrayBuffer, to: string): Promise<Blob> {
  if (!MAGICK_BROWSER_OUTPUTS.has(to)) {
    throw new Error(`Converting to ${to.toUpperCase()} isn't supported.`);
  }
  const magick = await loadMagick();
  const target = magickFormat(magick, to)!;
  const bytes = magick.ImageMagick.read(new Uint8Array(png), magick.MagickFormat.Png, (image) =>
    image.write(target, (data) => data.slice()),
  );
  return new Blob([bytes], { type: mimeTypeFor(to) });
}

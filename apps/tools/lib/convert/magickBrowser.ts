// ImageMagick (WASM) in the browser, for inputs the browser can't decode:
// camera RAW, PSD, TGA, DDS, TIFF, XCF. Loads the 14 MB wasm on first use.
import type { IMagickImage, MagickFormat as MagickFormatType } from "@imagemagick/magick-wasm";

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

// Formats ImageMagick writes that a canvas can't (ICNS and KTX have their own
// writers in texture-formats.ts). Camera RAW and HEIC can't be written by any
// engine we have.
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

// ICO and CUR store each side in one byte, so ImageMagick refuses to write
// an icon over 256 px (WidthOrHeightExceedsLimit). Larger images are fitted
// inside 256 x 256, keeping their aspect ratio.
const ICON_MAX_SIZE = 256;

function writeImage(magick: MagickModule, image: IMagickImage, format: string): Uint8Array<ArrayBuffer> {
  if ((format === "ico" || format === "cur") && (image.width > ICON_MAX_SIZE || image.height > ICON_MAX_SIZE)) {
    image.resize(ICON_MAX_SIZE, ICON_MAX_SIZE);
  }
  return image.write(magickFormat(magick, format)!, (data) => data.slice());
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
  const bytes = magick.ImageMagick.read(new Uint8Array(buf), source, (image) =>
    writeImage(magick, image, format),
  );
  return { buffer: bytes.buffer as ArrayBuffer, format };
}

// Re-encodes a PNG into a format a canvas can't produce.
export async function encodePngWithMagick(png: ArrayBuffer, to: string): Promise<Blob> {
  if (!MAGICK_BROWSER_OUTPUTS.has(to)) {
    throw new Error(`Converting to ${to.toUpperCase()} isn't supported.`);
  }
  const magick = await loadMagick();
  const bytes = magick.ImageMagick.read(new Uint8Array(png), magick.MagickFormat.Png, (image) =>
    writeImage(magick, image, to),
  );
  return new Blob([bytes], { type: mimeTypeFor(to) });
}

// Formats compressImageWithMagick shrinks. All are lossless except AVIF,
// which is re-encoded at the requested quality.
export const MAGICK_COMPRESS_FORMATS = new Set(["avif", "bmp", "gif", "tif", "tiff"]);
const LOSSLESS_FORMATS = new Set(["bmp", "gif", "tif", "tiff"]);

// Whether two files decode to the same pixels, frame by frame (coalesced, so
// a GIF frame is compared as shown).
function samePixels(magick: MagickModule, a: Uint8Array, b: Uint8Array, format: MagickFormatType): boolean {
  return magick.ImageMagick.readCollection(a, format, (first) => {
    first.coalesce();
    return magick.ImageMagick.readCollection(b, format, (second) => {
      second.coalesce();
      return (
        first.length === second.length &&
        first.every((image, index) => image.compare(second[index]!, magick.ErrorMetric.Absolute) === 0)
      );
    });
  });
}

// Compresses an image without changing its format. Every page of a TIFF and
// every frame of a GIF is kept. A lossless format comes back unchanged unless
// the result decodes to exactly the same pixels; so does any image deeper
// than 8 bits a channel, which this 8-bit ImageMagick build can't hold.
// Callers keep the original when the result isn't smaller.
export async function compressImageWithMagick(
  buf: ArrayBuffer,
  format: string,
  quality: number,
): Promise<ArrayBuffer> {
  if (!MAGICK_COMPRESS_FORMATS.has(format)) {
    throw new Error(`Compressing ${format.toUpperCase()} isn't supported.`);
  }
  const magick = await loadMagick();
  const magickFormatValue = magickFormat(magick, format)!;
  const { CompressionMethod } = magick;
  const input = new Uint8Array(buf);
  const bytes = magick.ImageMagick.readCollection(input, magickFormatValue, (images) => {
    if (images.length === 0) throw new Error(`The ${format.toUpperCase()} file has no image.`);
    if (images.some((image) => image.depth > 8)) return null;
    if (format === "gif") {
      // Re-optimise the frames: each stores only what changed from the last.
      images.coalesce();
      images.optimizePlus();
      images.optimizeTransparency();
    } else if (format === "bmp") {
      // BMP compresses only 8-bit palette images (RLE8). An image with more
      // than 256 colours would need lossy quantising, so it's left as is.
      // RLE8 has no alpha channel.
      const image = images[0]!;
      if (!image.hasAlpha && image.totalColors <= 256) {
        const settings = new magick.QuantizeSettings();
        settings.colors = 256;
        settings.ditherMethod = magick.DitherMethod.No;
        image.quantize(settings);
        image.settings.compression = CompressionMethod.RLE;
      }
    } else if (format === "avif") {
      for (const image of images) image.quality = Math.round(quality * 100);
    } else {
      for (const image of images) image.settings.compression = CompressionMethod.LZW;
    }
    return images.write(magickFormatValue, (data) => data.slice());
  });
  if (bytes === null) return buf;
  if (bytes.byteLength === 0) {
    throw new Error(`Couldn't write the compressed ${format.toUpperCase()} file.`);
  }
  if (LOSSLESS_FORMATS.has(format) && !samePixels(magick, input, bytes, magickFormatValue)) return buf;
  return bytes.buffer as ArrayBuffer;
}

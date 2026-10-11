// ImageMagick (WASM) in the browser, for inputs the browser can't decode:
// camera RAW, layered, legacy, Netpbm and high dynamic range images, and
// fonts. Loads the 14 MB wasm on first use.
import type { IMagickImage, MagickFormat as MagickFormatType } from "@imagemagick/magick-wasm";

import { drawFontSpecimen } from "./font-specimen.ts";
import { sfwToJpeg } from "./sfw.ts";

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

// Formats the browser can't decode that ImageMagick reads: camera RAW,
// layered or legacy image formats, Netpbm, JPEG XL and JPEG 2000, high
// dynamic range images (EXR, HDR) and fonts (TTF, OTF, drawn as a specimen).
// MacPaint (MAC) has no signature, so it's read with its format named, as
// every input is. SFW is repaired into a JPEG first (sfw.ts).
export const MAGICK_BROWSER_INPUTS = new Set([
  "arw", "cr2", "cr3", "crw", "dng", "nef", "orf", "raf", "rw2",
  "dds", "psd", "tga", "tif", "tiff", "xcf",
  "pam", "pbm", "pgm", "ppm", "pcx", "jxl", "jp2", "xpm", "wpg", "pcd", "mac", "sfw",
  "exr", "hdr",
  "ttf", "otf",
]);

const FONT_INPUTS = new Set(["ttf", "otf"]);

// Formats ImageMagick writes that a canvas can't (ICNS and KTX have their own
// writers in texture-formats.ts). Camera RAW and HEIC can't be written by any
// engine we have.
export const MAGICK_BROWSER_OUTPUTS = new Set([
  "bmp", "cur", "dds", "eps", "exr", "gif", "hdr", "ico", "jp2", "jxl", "pam",
  "pbm", "pcx", "pgm", "ppm", "psd", "rgb", "tga", "tif", "tiff", "wbmp",
  "xbm", "xpm", "avif", "jpeg", "jpg", "png", "webp", "pcd",
]);

const MIME_TYPES: Record<string, string> = {
  avif: "image/avif", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon",
  cur: "image/x-icon", jp2: "image/jp2", jpeg: "image/jpeg", jpg: "image/jpeg",
  jxl: "image/jxl", png: "image/png", psd: "image/vnd.adobe.photoshop",
  tif: "image/tiff", tiff: "image/tiff", webp: "image/webp", eps: "application/postscript",
  pcd: "image/x-photo-cd",
};

export function mimeTypeFor(ext: string) {
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// ICO and CUR store each side in one byte, so ImageMagick refuses to write
// an icon over 256 px (WidthOrHeightExceedsLimit). Larger images are fitted
// inside 256 x 256, keeping their aspect ratio.
const ICON_MAX_SIZE = 256;

function writeImage(magick: MagickModule, image: IMagickImage, format: string): Uint8Array<ArrayBuffer> {
  if (format === "ico" || format === "cur") {
    if (image.width > ICON_MAX_SIZE || image.height > ICON_MAX_SIZE) {
      image.resize(ICON_MAX_SIZE, ICON_MAX_SIZE);
    }
    // Store a 256 x 256 icon as a PNG, as Windows icons do and as magick-wasm
    // 0.0.37 did. Newer ImageMagick stores it as an uncompressed bitmap
    // unless this is set: 270 KB for any square image of 256 px or more.
    image.settings.setDefine(magick.MagickFormat.Icon, "png-compression-size", String(ICON_MAX_SIZE));
  }
  return image.write(magickFormat(magick, format)!, (data) => data.slice());
}

// Linear light (0 to 1) -> 8-bit sRGB, for each 8-bit linear value.
const SRGB_ENCODE = Uint8Array.from({ length: 256 }, (_, value) => {
  const linear = value / 255;
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
});

// OpenEXR and Radiance HDR store linear light with no upper limit. This 8-bit
// build of ImageMagick clamps each value above 1.0 to 1.0 as it reads one
// (there are no floating-point pixels left to tone map), so the image keeps
// the exposure it was saved with, as macOS Preview shows it, and highlights
// brighter than white are white. The linear values are encoded to sRGB, or
// the image would look dark, as `magick in.exr out.png` writes it.
function encodeLinearLight(magick: MagickModule, image: IMagickImage) {
  const { ColorSpace } = magick;
  // ImageMagick labels Radiance HDR linear RGB, and converting that to sRGB
  // encodes it. It labels OpenEXR sRGB, though its values are linear, so
  // those are encoded here; setting sRGB then only resets the gamma, or a
  // PNG would be tagged gamma 1.0 and shown washed out.
  if (image.colorSpace !== ColorSpace.RGB && image.colorSpace !== ColorSpace.LinearGray) {
    image.getPixels((pixels) => {
      const area = pixels.getArea(0, 0, image.width, image.height);
      const alpha = image.hasAlpha ? pixels.getChannelIndex(magick.PixelChannel.Alpha) : -1;
      const stride = image.channelCount;
      for (let index = 0; index < area.length; index += 1) {
        if (index % stride !== alpha) area[index] = SRGB_ENCODE[area[index]!]!;
      }
      pixels.setArea(0, 0, image.width, image.height, area);
    });
  }
  image.colorSpace = ColorSpace.sRGB;
}

// Reads `bytes` as `from` (`source` in ImageMagick) and hands the image to `handle`.
function readInput<T>(
  magick: MagickModule,
  bytes: Uint8Array,
  from: string,
  source: MagickFormatType,
  handle: (image: IMagickImage) => T,
): T {
  if (FONT_INPUTS.has(from)) return drawFontSpecimen(magick, bytes, from, handle);
  if (from === "sfw") {
    return magick.ImageMagick.read(sfwToJpeg(bytes), magick.MagickFormat.Jpeg, (image) => {
      image.flip();
      return handle(image);
    });
  }
  return magick.ImageMagick.read(bytes, source, (image) => {
    if (from === "exr" || from === "hdr") encodeLinearLight(magick, image);
    return handle(image);
  });
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
  const bytes = readInput(magick, new Uint8Array(buf), from, source, (image) => writeImage(magick, image, format));
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

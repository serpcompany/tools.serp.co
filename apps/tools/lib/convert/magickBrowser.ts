// ImageMagick (WASM) in the browser, for inputs the browser can't decode:
// camera RAW, layered, legacy, Netpbm and high dynamic range images, and
// fonts. Loads the 14 MB wasm on first use.
import type { IMagickImage, MagickFormat as MagickFormatType } from "@imagemagick/magick-wasm";

import { decodeFailure, isDecodeFailure, tooLargeFailure } from "./decode-failure.ts";

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

// Formats the browser decodes that ImageMagick reads too, for a browser
// with no decoder for one (BIN to JPG, JPEG and PNG, workerClient.ts). Not
// SVG: this build hands it to Inkscape, which it hasn't got.
export const MAGICK_FALLBACK_INPUTS = new Set(["avif", "bmp", "cur", "gif", "ico", "jpeg", "jpg", "png", "webp"]);

const FONT_INPUTS = new Set(["ttf", "otf"]);
// High dynamic range inputs, encoded from linear light to sRGB (linear-light.ts).
const LINEAR_LIGHT_INPUTS = new Set(["exr", "hdr"]);

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

// Reads `bytes` as `from` (`source` in ImageMagick) and hands the image to
// `handle`. The code for fonts, SFW and linear light loads only when one is
// converted, so it isn't in the script every converter page loads.
async function readInput<T>(
  magick: MagickModule,
  bytes: Uint8Array,
  from: string,
  source: MagickFormatType,
  handle: (image: IMagickImage) => T,
): Promise<T> {
  if (FONT_INPUTS.has(from)) {
    const { drawFontSpecimen } = await import("./font-specimen.ts");
    return drawFontSpecimen(magick, bytes, from, handle);
  }
  if (from === "sfw") {
    const { sfwToJpeg } = await import("./sfw.ts");
    return readPicture(magick, sfwToJpeg(bytes), magick.MagickFormat.Jpeg, (image) => {
      image.flip();
      return handle(image);
    });
  }
  if (LINEAR_LIGHT_INPUTS.has(from)) {
    const { encodeLinearLight } = await import("./linear-light.ts");
    return readPicture(magick, bytes, source, (image) => {
      encodeLinearLight(magick, image);
      return handle(image);
    });
  }
  return readPicture(magick, bytes, source, handle);
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
  if (!source || !(MAGICK_BROWSER_INPUTS.has(from) || MAGICK_FALLBACK_INPUTS.has(from))) {
    throw new Error(`${from.toUpperCase()} isn't supported by the image converter.`);
  }
  const format = MAGICK_BROWSER_OUTPUTS.has(to) ? to : "png";
  const bytes = await readInput(magick, new Uint8Array(buf), from, source, (image) => writeImage(magick, image, format));
  return { buffer: bytes.buffer as ArrayBuffer, format };
}

// Reads `bytes` as `format` and hands the picture to `use`. ImageMagick has
// loaded by now, so a failure while it reads the file is the file's
// (readFailure); a failure in `use`, such as writing the picture, isn't.
function readPicture<T>(
  magick: MagickModule,
  bytes: Uint8Array,
  format: MagickFormatType,
  use: (image: IMagickImage) => T,
): T {
  let read = false;
  try {
    return magick.ImageMagick.read(bytes, format, (image) => {
      // A reader that gives up without an error (DDS's, on a file cut
      // short) leaves no picture: the image is already disposed.
      try {
        void image.width;
      } catch (error) {
        throw decodeFailure("The picture in this file couldn't be read.", error);
      }
      read = true;
      return use(image);
    });
  } catch (error) {
    throw read ? error : readFailure(magick, bytes, format, error);
  }
}

// What a failure while ImageMagick reads a file says. Running out of memory
// (an allocation's RangeError, a WASM trap, ImageMagick's
// ResourceLimitError) is the file's when its header declares a picture the
// engine can't hold: damaged, or too large to convert here. Otherwise it's
// the engine's, and the error is passed on as it is. Any other failure is
// the file's: a decode failure (decode-failure.ts).
function readFailure(magick: MagickModule, bytes: Uint8Array, format: MagickFormatType, error: unknown): unknown {
  const failure = typeof error === "number" ? cppFailure(magick, error) : error;
  const outOfMemory =
    failure instanceof RangeError ||
    failure instanceof WebAssembly.RuntimeError ||
    (failure instanceof magick.MagickError && failure.severity === magick.MagickErrorSeverity.ResourceLimitError);
  if (outOfMemory) {
    return declaresTooLarge(magick, bytes, format) ? tooLargeFailure(failure.message, failure) : failure;
  }
  if (isDecodeFailure(failure)) return failure;
  return decodeFailure(failure instanceof Error ? failure.message : String(failure), failure);
}

// The most memory this engine can have: a 32-bit WASM module addresses 4 GB.
const ENGINE_MEMORY = 2 ** 32;

// Whether the file's header declares a picture this engine can't hold: its
// pixels alone (4 bytes each, 8-bit RGBA) would take over half the engine's
// memory, about 537 megapixels. A header ImageMagick can't read is the
// file's too; one it can't read for want of memory isn't.
function declaresTooLarge(magick: MagickModule, bytes: Uint8Array, format: MagickFormatType): boolean {
  const image = magick.MagickImage.create();
  try {
    image.ping(bytes, new magick.MagickReadSettings({ format }));
    return image.width * image.height * 4 > ENGINE_MEMORY / 2;
  } catch (error) {
    return error instanceof magick.MagickError && error.severity !== magick.MagickErrorSeverity.ResourceLimitError;
  } finally {
    image.dispose();
  }
}

// LibRaw's exceptions (LibRaw_exceptions in libraw_const.h, 0.21): whether
// each is the file's, too large, or memory, and what it says. 6, cancelled
// by a callback, can't happen: none is set.
const LIBRAW_EXCEPTIONS: Readonly<Record<number, { kind: "file" | "too-large" | "memory"; message: string }>> = {
  1: { kind: "memory", message: "LibRaw ran out of memory reading the RAW file." },
  2: { kind: "file", message: "The RAW file's picture couldn't be decoded: it may be damaged." },
  3: { kind: "file", message: "The RAW file's JPEG-compressed picture couldn't be decoded: it may be damaged." },
  4: { kind: "file", message: "The RAW file ends before its picture does: it may be incomplete." },
  5: { kind: "file", message: "The RAW file is damaged." },
  7: { kind: "file", message: "The RAW file's crop area is outside its picture: it may be damaged." },
  8: { kind: "file", message: "The RAW file couldn't be read: it may be damaged." },
  9: { kind: "file", message: "The RAW file's JPEG 2000 picture couldn't be decoded: it may be damaged." },
  10: { kind: "too-large", message: "The RAW file declares a picture too large to convert here." },
  11: { kind: "memory", message: "LibRaw ran out of memory reading the RAW file." },
  12: { kind: "file", message: "The RAW file is in a format LibRaw doesn't read, or it is damaged." },
};

// A C++ exception thrown out of the WASM build, which arrives as a bare
// number, the address of the thrown object, as an error: LibRaw's (a RAW
// file cut short or damaged) by its code, std::bad_alloc as memory running
// out (a RangeError, as a JavaScript allocation's is). Any other, thrown
// while reading a file, is the file's.
function cppFailure(magick: MagickModule, pointer: number): Error {
  const thrown = cppException(magick, pointer);
  const libraw = thrown?.type === "17LibRaw_exceptions" ? LIBRAW_EXCEPTIONS[thrown.value] : undefined;
  if (libraw?.kind === "memory" || thrown?.type === "St9bad_alloc") {
    return new RangeError(libraw?.message ?? "ImageMagick ran out of memory reading the file.", { cause: pointer });
  }
  if (libraw?.kind === "too-large") return tooLargeFailure(libraw.message, pointer);
  return decodeFailure(libraw?.message ?? "The picture in this file couldn't be read.", pointer);
}

type MagickHeap = { HEAPU8?: Uint8Array; UTF8ToString?: (pointer: number) => string };

// The type and first 4 bytes of the C++ exception thrown at `pointer`, or
// null. Emscripten keeps the exception's type 20 bytes before the object
// (in its __cxa_throw ExceptionInfo), and a type_info keeps its name 4
// bytes in. The heap is magick-wasm's (`ImageMagick._api`), not its API.
function cppException(magick: MagickModule, pointer: number): { type: string; value: number } | null {
  try {
    const api = (magick.ImageMagick as unknown as { _api?: MagickHeap })._api;
    const heap = api?.HEAPU8;
    if (!heap || !api.UTF8ToString || !Number.isInteger(pointer) || pointer < 20 || pointer + 4 > heap.length) {
      return null;
    }
    const view = new DataView(heap.buffer, heap.byteOffset, heap.byteLength);
    const typeInfo = view.getUint32(pointer - 20, true);
    if (typeInfo + 8 > heap.length) return null;
    return { type: api.UTF8ToString(view.getUint32(typeInfo + 4, true)), value: view.getInt32(pointer, true) };
  } catch {
    return null;
  }
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

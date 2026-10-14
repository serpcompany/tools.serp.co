import { decodeFailure, noBrowserDecoder } from "./decode-failure.ts";
import { decodeHeifToRGBA, type RGBA } from "./heif.ts";

type CanvasSource = CanvasImageSource & {
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
  close?: () => void;
};

type ImageDecoderLike = {
  decode: () => Promise<{ image: CanvasSource }>;
  close?: () => void;
};

type ImageDecoderCtor = new (init: { data: BufferSource; type?: string }) => ImageDecoderLike;

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

function getCanvasDimensions(source: CanvasSource) {
  const width =
    typeof source.width === "number" ? source.width : source.displayWidth;
  const height =
    typeof source.height === "number" ? source.height : source.displayHeight;

  if (!width || !height) {
    throw new Error("Failed to read image dimensions.");
  }

  return { width, height };
}

/** Draws an ImageBitmap/VideoFrame into a canvas and returns RGBA data */
async function bitmapToRGBA(source: CanvasSource): Promise<RGBA> {
  const { width, height } = getCanvasDimensions(source);
  const useOffscreen = typeof OffscreenCanvas !== "undefined";
  const canvas: CanvasLike = useOffscreen
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create 2D canvas context.");
  }
  const ctx2d = ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx2d.drawImage(source, 0, 0, width, height);
  const img = ctx2d.getImageData(0, 0, width, height);
  source.close?.();
  return { data: img.data, width: img.width, height: img.height };
}

// An <img> couldn't load the file: it's damaged, or this browser has no
// decoder for its format (decodeToRGBA tells which).
class ImageLoadError extends Error {}

async function decodeViaImage(blob: Blob): Promise<RGBA> {
  if (typeof document === "undefined") {
    throw new Error("Image decoding requires a document.");
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";

    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new ImageLoadError("Image decode failed."));
    });

    img.src = url;

    if ("decode" in img) {
      try {
        await (img as HTMLImageElement).decode();
      } catch {
        await loaded;
      }
    } else {
      await loaded;
    }

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { data: imageData.data, width: imageData.width, height: imageData.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeWithImageDecoder(mime: string | undefined, buf: ArrayBuffer): Promise<RGBA | null> {
  const ImageDecoderCtor = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (!ImageDecoderCtor || !mime) return null;

  try {
    const decoder = new ImageDecoderCtor({ data: buf, type: mime });
    const result = await decoder.decode();
    decoder.close?.();
    return bitmapToRGBA(result.image as CanvasSource);
  } catch {
    return null;
  }
}

// The browser decoders' formats, by the type ImageDecoder is given.
const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  tiff: "image/tiff",
};

// Every format decodeToRGBA reads by name (bin-image.test.mjs checks that
// each has a signature).
export const DECODE_INPUTS: readonly string[] = ["heic", "heif", "ktx", "ktx2", "icns", ...Object.keys(MIME_TYPES)];

export async function decodeToRGBA(ext: string, buf: ArrayBuffer): Promise<RGBA> {
  const e = (ext || "").toLowerCase();

  if (e === "heic" || e === "heif") {
    return decodeHeifToRGBA(buf);
  }

  if (e === "ktx" || e === "ktx2") {
    const { decodeKtx1, decodeKtx2 } = await import("./texture-formats.ts");
    return e === "ktx" ? decodeKtx1(new Uint8Array(buf)) : decodeKtx2(new Uint8Array(buf));
  }

  if (e === "icns") {
    const { largestIcnsPng } = await import("./texture-formats.ts");
    const png = largestIcnsPng(new Uint8Array(buf));
    return decodeToRGBA("png", png.slice().buffer);
  }

  const mime = MIME_TYPES[e];
  try {
    return await decodeInBrowser(mime, buf);
  } catch (error) {
    if (!(error instanceof ImageLoadError)) throw error;
    // The file is damaged if the browser decodes its format's sample.
    if (await browserDecodes(e)) throw decodeFailure(error.message);
    throw noBrowserDecoder(e);
  }
}

// Decodes with the browser: ImageDecoder when there is one (in workers too),
// else createImageBitmap, else, on a page, an <img>.
async function decodeInBrowser(mime: string | undefined, buf: ArrayBuffer): Promise<RGBA> {
  const decoded = await decodeWithImageDecoder(mime, buf);
  if (decoded) return decoded;

  const blob = new Blob([buf], { type: mime || "application/octet-stream" });

  try {
    if (typeof createImageBitmap !== "function") {
      throw new Error("createImageBitmap unavailable.");
    }
    const bitmap = await createImageBitmap(blob);
    return bitmapToRGBA(bitmap as CanvasSource);
  } catch {
    if (typeof document !== "undefined") {
      return decodeViaImage(blob);
    }
    throw new Error("This format isn’t natively supported by your browser.");
  }
}

// A 1 x 1 picture in each format the browser decodes for decodeToRGBA (made
// with ImageMagick: 8-bit, and AVIF's AV1 Main profile, which every browser
// that shows AVIF decodes), to tell a browser with no decoder for a format
// (AVIF before Safari 16.4) from a damaged file. TIFF has none: only Safari
// decodes it, and the converters send it to ImageMagick.
const SAMPLES: Readonly<Record<string, string>> = {
  jpg: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AD9ToUf/2Q==",
  png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12MwKLgAAAJEAXGkv/cwAAAAAElFTkSuQmCC",
  gif: "R0lGODlhAQABAPAAADBw0AAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  webp: "UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+6zb//PTNeYP8nP/izkYjsvAAAA==",
  bmp: "Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAA0HAwAA==",
  avif: "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAD6AAEAAAAAAAAAHQAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgQAMAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAlbWRhdBIACggYAAYICGg0IDIPGAAKKKKEAACwDGH8MILE",
  ico: "AAABAAEAAQEAAAEAIAAwAAAAFgAAACgAAAABAAAAAgAAAAEAIAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAADQcDD/AAAAAA==",
  cur: "AAACAAEAAQEAAAAAAAAwAAAAFgAAACgAAAABAAAAAgAAAAEAIAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAADQcDD/AAAAAA==",
  svg: "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=",
};

// `format`'s sample (SAMPLES), or null.
export function browserSample(format: string): Uint8Array<ArrayBuffer> | null {
  const sample = SAMPLES[format === "jpeg" ? "jpg" : format];
  return sample ? Uint8Array.from(atob(sample), (char) => char.charCodeAt(0)) : null;
}

const browserSupport = new Map<string, Promise<boolean>>();

// Whether this browser decodes `format`, from its sample, decoded once.
// Without a sample, the browser is taken to decode it.
function browserDecodes(format: string): Promise<boolean> {
  const sample = browserSample(format);
  if (!sample) return Promise.resolve(true);
  let supported = browserSupport.get(format);
  if (!supported) {
    supported = decodeInBrowser(MIME_TYPES[format], sample.buffer).then(() => true, () => false);
    browserSupport.set(format, supported);
  }
  return supported;
}

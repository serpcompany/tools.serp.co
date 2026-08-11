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

type ImageDecoderCtor = new (init: {
  data: BufferSource;
  type?: string;
}) => ImageDecoderLike;

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
  const ctx2d = ctx as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  try {
    ctx2d.drawImage(source, 0, 0, width, height);
    const img = ctx2d.getImageData(0, 0, width, height);
    return { data: img.data, width: img.width, height: img.height };
  } finally {
    source.close?.();
  }
}

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
      img.onerror = () => reject(new Error("Image decode failed."));
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
    return {
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeWithImageDecoder(
  mime: string | undefined,
  buf: ArrayBuffer,
  signal?: AbortSignal,
): Promise<RGBA | null> {
  const ImageDecoderCtor = (globalThis as { ImageDecoder?: ImageDecoderCtor })
    .ImageDecoder;
  if (!ImageDecoderCtor || !mime) return null;

  const decoder = new ImageDecoderCtor({ data: buf, type: mime });
  const onAbort = () => decoder.close?.();
  try {
    const result = await awaitWithSignal(decoder.decode(), signal, onAbort);
    return bitmapToRGBA(result.image as CanvasSource);
  } catch {
    signal?.throwIfAborted();
    return null;
  } finally {
    decoder.close?.();
  }
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    onAbort?.();
    rejectAbort?.(
      signal.reason ??
        new DOMException("The operation was aborted", "AbortError"),
    );
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function decodeToRGBA(
  ext: string,
  buf: ArrayBuffer,
  signal?: AbortSignal,
): Promise<RGBA> {
  const e = (ext || "").toLowerCase();
  signal?.throwIfAborted();

  if (e === "heic" || e === "heif") {
    return decodeHeifToRGBA(buf, signal);
  }

  const mimeMap: Record<string, string> = {
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

  const mime = mimeMap[e];

  // Prefer ImageDecoder when available (works in workers too).
  const decoded = await decodeWithImageDecoder(mime, buf, signal);
  if (decoded) return decoded;

  // Browser-native decoders handle: jpg/jpeg/png/webp/gif/bmp/avif/ico (varies by engine)
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

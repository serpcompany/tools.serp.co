// Image compression in the browser (issue #147, Lane 4), for the formats the
// jsquash worker doesn't take: SVG through SVGO, and AVIF, BMP, GIF and TIFF
// through ImageMagick WASM. Replaces /api/image-compress, which fails on
// Workers. A result that isn't smaller is discarded for the original.

import { compressImageWithMagick } from "./magickBrowser.ts";

export const BROWSER_IMAGE_COMPRESS_FORMATS = new Set(["avif", "bmp", "gif", "svg", "tif", "tiff"]);

// SVGO drops the XML declaration, so a file in another encoding would be
// re-read as UTF-8 and garbled. Only UTF-8 files are optimised.
async function compressSvg(buf: ArrayBuffer): Promise<ArrayBuffer> {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return buf;
  }
  if (/^\s*<\?xml[^>]*encoding\s*=\s*["'](?!utf-?8)/i.test(source)) return buf;
  const { optimize } = await import("svgo/browser");
  const { data } = optimize(source, { multipass: true });
  return new TextEncoder().encode(data).buffer as ArrayBuffer;
}

export async function compressImageInBrowser(
  buf: ArrayBuffer,
  format: string,
  quality = 0.82,
): Promise<ArrayBuffer> {
  const normalized = format.toLowerCase();
  if (!BROWSER_IMAGE_COMPRESS_FORMATS.has(normalized)) {
    throw new Error(`Compressing ${format.toUpperCase()} isn't supported.`);
  }
  const output =
    normalized === "svg"
      ? await compressSvg(buf)
      : await compressImageWithMagick(buf, normalized, quality);
  return output.byteLength < buf.byteLength ? output : buf;
}

import type { RGBA } from "./heif.ts";

export async function encodeFromRGBA(
  toExt: string,
  rgba: RGBA,
  quality = 0.85
): Promise<Blob> {
  const useOffscreen = typeof OffscreenCanvas !== "undefined";
  const canvas: HTMLCanvasElement | OffscreenCanvas = useOffscreen
    ? new OffscreenCanvas(rgba.width, rgba.height)
    : Object.assign(document.createElement("canvas"), { width: rgba.width, height: rgba.height });

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create 2D canvas context.");
  }
  const ctx2d = ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx2d.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height), 0, 0);

  const canvasToBlob = async (type: string, q?: number) => {
    if ("convertToBlob" in canvas) {
      return (canvas as OffscreenCanvas).convertToBlob({
        type,
        quality: type === "image/png" ? undefined : q,
      });
    }
    return new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        type,
        type === "image/png" ? undefined : q
      );
    });
  };

  if (toExt === "ktx" || toExt === "ktx2") {
    const { encodeKtx1, encodeKtx2 } = await import("./texture-formats.ts");
    const bytes = toExt === "ktx" ? encodeKtx1(rgba) : encodeKtx2(rgba);
    return new Blob([bytes], { type: toExt === "ktx" ? "image/ktx" : "image/ktx2" });
  }

  if (toExt === "icns") {
    // One PNG per icon size, each fitted into a transparent square.
    const { buildIcns, ICNS_WRITE_TYPES } = await import("./texture-formats.ts");
    const entries = [];
    for (const [type, size] of ICNS_WRITE_TYPES) {
      const icon: HTMLCanvasElement | OffscreenCanvas = useOffscreen
        ? new OffscreenCanvas(size, size)
        : Object.assign(document.createElement("canvas"), { width: size, height: size });
      const iconCtx = icon.getContext("2d") as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!iconCtx) throw new Error("Failed to create 2D canvas context.");
      const scale = Math.min(size / rgba.width, size / rgba.height);
      const width = Math.max(1, Math.round(rgba.width * scale));
      const height = Math.max(1, Math.round(rgba.height * scale));
      iconCtx.imageSmoothingQuality = "high";
      iconCtx.drawImage(
        canvas,
        Math.round((size - width) / 2),
        Math.round((size - height) / 2),
        width,
        height,
      );
      const blob =
        "convertToBlob" in icon
          ? await (icon as OffscreenCanvas).convertToBlob({ type: "image/png" })
          : await new Promise<Blob>((resolve, reject) =>
              (icon as HTMLCanvasElement).toBlob(
                (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
                "image/png",
              ),
            );
      entries.push({ type, png: new Uint8Array(await blob.arrayBuffer()) });
    }
    return new Blob([buildIcns(entries)], { type: "image/icns" });
  }

  if (toExt === "svg") {
    const pngBlob = await canvasToBlob("image/png");
    const buffer = await pngBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    if (typeof btoa !== "function") {
      throw new Error("Base64 encoding not supported in this environment.");
    }
    const base64 = btoa(binary);
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${rgba.width}" height="${rgba.height}" viewBox="0 0 ${rgba.width} ${rgba.height}">`,
      `<image href="data:image/png;base64,${base64}" width="${rgba.width}" height="${rgba.height}" />`,
      `</svg>`
    ].join("");
    return new Blob([svg], { type: "image/svg+xml" });
  }

  if (toExt === "pdf") {
    const pngBlob = await canvasToBlob("image/png");
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
    const { PDFDocument } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.create();
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([rgba.width, rgba.height]);
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: rgba.width,
      height: rgba.height,
    });
    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;
    return new Blob([pdfBuffer], { type: "application/pdf" });
  }

  const canvasMime =
    toExt === "jpg" || toExt === "jpeg" || toExt === "jfif" || toExt === "jif" ? "image/jpeg" :
    toExt === "webp" ? "image/webp" :
    toExt === "avif" ? "image/avif" :
    toExt === "png" ? "image/png" :
    null;

  if (canvasMime) {
    const blob = await canvasToBlob(canvasMime, quality);
    // Browsers silently return PNG for types they can't encode (e.g. AVIF).
    if (blob.type === canvasMime) return blob;
  }

  // Never label a PNG as another format: encode it with ImageMagick, which
  // throws for formats nothing here can write.
  const png = await canvasToBlob("image/png");
  const { encodePngWithMagick } = await import("./magickBrowser.ts");
  return encodePngWithMagick(await png.arrayBuffer(), toExt);
}

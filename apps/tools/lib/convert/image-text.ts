// Images into text documents (issue #147, Lane 3): JPG and PNG to TXT by OCR
// with tesseract.js, and to DOCX as a Word page showing the image. Both load
// their library only when one of these Tools runs.

export type Recognize = (image: Blob) => Promise<string>;

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

// Width and height from a PNG's IHDR chunk or a JPEG's start-of-frame marker.
export function imageSize(buf: ArrayBuffer, format: string): { width: number; height: number } {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  if (format === "png" && bytes.length >= 24 && bytes[12] === 0x49 && bytes[15] === 0x52) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (format === "jpg" || format === "jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!;
      const length = view.getUint16(offset + 2);
      // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  throw new Error("Couldn't read the image's dimensions.");
}

// Tesseract's worker, its SIMD LSTM core and the English model (4.0.0
// best_int) are served from this site, not tesseract.js's default jsDelivr
// URLs. image-text.test.mjs checks the copies match the installed packages.
export const TESSERACT_ASSETS = "/vendor/tesseract";

const recognizeWithTesseract: Recognize = async (image) => {
  const { createWorker } = await import("tesseract.js");
  const base = new URL(`${TESSERACT_ASSETS}/`, globalThis.location.href).href;
  const worker = await createWorker("eng", undefined, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
    langPath: base.replace(/\/$/, ""),
    workerBlobURL: false,
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
};

export async function textFromImage(
  buf: ArrayBuffer,
  format: string,
  recognize: Recognize = recognizeWithTesseract,
): Promise<ArrayBuffer> {
  const raw = await recognize(new Blob([buf], { type: IMAGE_TYPES[format] ?? "image/png" }));
  const text = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw new Error("No text was found in this image.");
  return new TextEncoder().encode(`${text}\n`).buffer as ArrayBuffer;
}

// Word measures the picture in pixels at 96 dpi. A Letter page with 1-inch
// margins has 6.5 inches for it.
const TEXT_WIDTH_PX = 6.5 * 96;

export async function imageToDocx(buf: ArrayBuffer, format: string): Promise<ArrayBuffer> {
  const type = format === "png" ? "png" : "jpg";
  const size = imageSize(buf, format);
  const scale = Math.min(1, TEXT_WIDTH_PX / size.width);
  const { Document, ImageRun, Packer, Paragraph } = await import("docx");
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                type,
                data: new Uint8Array(buf),
                transformation: { width: size.width * scale, height: size.height * scale },
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toArrayBuffer(doc);
}

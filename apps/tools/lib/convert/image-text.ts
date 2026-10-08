// Images into text documents (issue #147, Lane 3): JPG and PNG to TXT by OCR
// with tesseract.js, and to DOCX as a Word page showing the image. Both load
// their library only when one of these Tools runs.

export type Recognize = (image: Blob) => Promise<string>;

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

// The EXIF Orientation tag (0x0112) in a JPEG's APP1 segment, or 1.
function exifOrientation(view: DataView, segment: number, length: number): number {
  const tiff = segment + 10;
  if (tiff + 8 > segment + 2 + length || view.getUint32(segment + 4) !== 0x45786966) return 1;
  const little = view.getUint16(tiff) === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > view.byteLength) return 1;
  const entries = view.getUint16(ifd, little);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > view.byteLength) break;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return 1;
}

// Width and height as shown: from a PNG's IHDR chunk, or a JPEG's
// start-of-frame marker turned by its EXIF orientation (5-8 are quarter turns).
export function imageSize(buf: ArrayBuffer, format: string): { width: number; height: number } {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  if (format === "png" && bytes.length >= 24 && bytes[12] === 0x49 && bytes[15] === 0x52) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (format === "jpg" || format === "jpeg") {
    let orientation = 1;
    let offset = 2;
    while (offset + 3 < bytes.length && bytes[offset] === 0xff) {
      // Any number of 0xFF fill bytes may come before a marker.
      while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) offset += 1;
      const marker = bytes[offset + 1]!;
      if (offset + 3 >= bytes.length) break;
      const length = view.getUint16(offset + 2);
      if (marker === 0xe1) orientation = exifOrientation(view, offset, length);
      // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (offset + 9 > bytes.length) break;
        const width = view.getUint16(offset + 7);
        const height = view.getUint16(offset + 5);
        return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
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
  // errorHandler keeps a failed start (say, a missing model) from also
  // throwing an uncaught error; createWorker still rejects with it.
  const worker = await createWorker("eng", undefined, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
    langPath: base.replace(/\/$/, ""),
    workerBlobURL: false,
    errorHandler: () => {},
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
// margins has 6.5 x 9 inches for it.
const TEXT_WIDTH_PX = 6.5 * 96;
const TEXT_HEIGHT_PX = 9 * 96;

export async function imageToDocx(buf: ArrayBuffer, format: string): Promise<ArrayBuffer> {
  const type = format === "png" ? "png" : "jpg";
  const size = imageSize(buf, format);
  const scale = Math.min(1, TEXT_WIDTH_PX / size.width, TEXT_HEIGHT_PX / size.height);
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

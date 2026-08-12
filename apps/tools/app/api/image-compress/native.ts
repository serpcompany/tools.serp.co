import imagemin from "imagemin";
import imageminGifsicle from "imagemin-gifsicle";
import sharp from "sharp";

import { mapQualityToImageQuality } from "@/lib/compression-utils";

export type ServerNativeImageCompressFormat =
  | "avif"
  | "gif"
  | "heic"
  | "heif"
  | "tif"
  | "tiff";

export async function compressServerNativeImage(
  format: ServerNativeImageCompressFormat,
  buffer: Buffer,
): Promise<Buffer> {
  if (format === "gif") {
    return imagemin.buffer(buffer, {
      plugins: [
        imageminGifsicle({
          optimizationLevel: 2,
        }),
      ],
    });
  }

  const quality = mapQualityToImageQuality(0.82);
  switch (format) {
    case "avif":
      return sharp(buffer).avif({ quality }).toBuffer();
    case "heic":
    case "heif":
      return sharp(buffer).heif({ quality }).toBuffer();
    case "tif":
    case "tiff":
      return sharp(buffer).tiff({ compression: "lzw", quality }).toBuffer();
    default:
      throw new Error(`Unsupported native image compression format: ${format}`);
  }
}

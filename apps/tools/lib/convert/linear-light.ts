// OpenEXR and Radiance HDR store linear light with no upper limit. This 8-bit
// build of ImageMagick clamps each value above 1.0 to 1.0 as it reads one
// (there are no floating-point pixels left to tone map), so the image keeps
// the exposure it was saved with, as macOS Preview shows it, and highlights
// brighter than white are white. The linear values are encoded to sRGB, or
// the image would look dark, as `magick in.exr out.png` writes it. They were
// rounded to 256 levels before encoding, so dark gradients band (#275).
import type { IMagickImage } from "@imagemagick/magick-wasm";

type MagickModule = typeof import("@imagemagick/magick-wasm");

// Linear light (0 to 1) -> 8-bit sRGB, for each 8-bit linear value.
const SRGB_ENCODE = Uint8Array.from({ length: 256 }, (_, value) => {
  const linear = value / 255;
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
});

export function encodeLinearLight(magick: MagickModule, image: IMagickImage) {
  const { ColorSpace } = magick;
  // ImageMagick labels Radiance HDR linear RGB, and converting that to sRGB
  // encodes it. It labels OpenEXR sRGB, though its values are linear, so
  // those are encoded here; setting sRGB then only resets the gamma, or a
  // PNG would be tagged gamma 1.0 and shown washed out.
  if (image.colorSpace !== ColorSpace.RGB && image.colorSpace !== ColorSpace.LinearGray) {
    const { width, height, channelCount: stride } = image;
    image.getPixels((pixels) => {
      const alpha = image.hasAlpha ? pixels.getChannelIndex(magick.PixelChannel.Alpha) : -1;
      // A row at a time. getArea returns a view into WASM memory, and
      // setArea allocates, which can grow that memory and detach the view,
      // so each row is copied out first.
      for (let y = 0; y < height; y += 1) {
        const row = pixels.getArea(0, y, width, 1).slice();
        for (let index = 0; index < row.length; index += 1) {
          if (index % stride !== alpha) row[index] = SRGB_ENCODE[row[index]!]!;
        }
        pixels.setArea(0, y, width, 1, row);
      }
    });
  }
  image.colorSpace = ColorSpace.sRGB;
}

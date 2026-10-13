// An SVG that a renderer wrote (Graphviz, pptx-glimpse) drawn as pixels
// (issue #265): through an <img>, which runs no script and loads nothing
// outside the SVG, onto a white canvas at the size asked for.

import { MAX_IMAGE_SIDE } from "./document-images.ts";
import type { RGBA } from "./heif.ts";

// The SVG's size in points, from its root's width and height (pt, or px at
// 0.75 pt each, or no unit as px), else its viewBox.
export function svgSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  if (!root) return null;
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(root)?.[1];
  const points = (value: string | undefined) => {
    const match = value ? /^\s*([\d.]+)\s*(pt|px)?\s*$/.exec(value) : null;
    if (!match) return NaN;
    return match[2] === "pt" ? Number(match[1]) : Number(match[1]) * 0.75;
  };
  let width = points(attribute("width"));
  let height = points(attribute("height"));
  if (!(width > 0 && height > 0)) {
    const box = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (!box || box.length !== 4) return null;
    [width, height] = [box[2]!, box[3]!];
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

// The image's size in pixels: `scale` pixels a point, or fewer when a side
// would pass MAX_IMAGE_SIDE.
export function svgImageSize(width: number, height: number, scale: number): { width: number; height: number; scale: number } {
  const fitted = Math.min(scale, MAX_IMAGE_SIDE / width, MAX_IMAGE_SIDE / height);
  return {
    width: Math.min(MAX_IMAGE_SIDE, Math.max(1, Math.round(width * fitted))),
    height: Math.min(MAX_IMAGE_SIDE, Math.max(1, Math.round(height * fitted))),
    scale: fitted,
  };
}

// The SVG as it's drawn: `width` x `height` pixels, without a stylesheet
// link (Graphviz's `stylesheet` attribute) or an image that isn't in the SVG
// itself (a picture a slide links to). An <img> wouldn't load either; they're
// removed anyway. `fontFamily` is the font of text that names none, which
// would otherwise be the browser's default serif.
export function prepareSvgForImage(svg: string, width: number, height: number, fontFamily?: string): string {
  const font = fontFamily ? ` font-family="${fontFamily.replace(/[^\p{L}\p{N}\s,.'-]/gu, "")}"` : "";
  return svg
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/g, "")
    .replace(/<image\b[^>]*?(?:\/>|>[\s\S]*?<\/image>)/g, (tag) => (/\shref\s*=\s*["']data:/.test(tag.replace(/xlink:href/g, "href")) ? tag : ""))
    .replace(/<svg\b[^>]*>/, (root) =>
      root
        .replace(/\s(width|height)\s*=\s*"[^"]*"/g, "")
        .replace(/\sfont-family\s*=\s*"[^"]*"/g, font ? "" : "$&")
        .replace(/^<svg\b/, `<svg width="${width}" height="${height}" preserveAspectRatio="none"${font}`),
    );
}

// Draws the SVG through an <img> on a white canvas of `width` x `height`.
export async function rasterizeSvg(svg: string, width: number, height: number): Promise<RGBA> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error("The picture couldn't be drawn in this browser.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Failed to create 2D canvas context.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

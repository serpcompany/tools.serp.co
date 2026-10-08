// Images into document formats (issue #147, Lane 3): SVG to an HTML page,
// SVG to a vector AI file, and an image to a one-page EPUB. Raster AI and PCD
// are written by encode.ts; this module covers the outputs that aren't a
// re-encoded raster.

import { strToU8, zipSync } from "fflate";

import { EPUB_IMAGE_TYPES } from "./image-document-targets.ts";

export { isImageDocumentConversion } from "./image-document-targets.ts";

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "") || "image";

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

// The <svg> element and what follows it, without the XML declaration,
// doctype or comments before it, which HTML doesn't allow there.
function svgMarkup(buf: ArrayBuffer): string {
  const source = new TextDecoder().decode(buf);
  const start = source.search(/<svg[\s>]/i);
  if (start === -1) throw new Error("This file has no SVG drawing in it.");
  return source.slice(start).trim();
}

export function svgToHtml(buf: ArrayBuffer, fileName: string): ArrayBuffer {
  const html = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeXml(baseName(fileName))}</title>`,
    "<style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;height:auto}</style>",
    "</head>",
    "<body>",
    svgMarkup(buf),
    "</body>",
    "</html>",
    "",
  ].join("\n");
  return toArrayBuffer(strToU8(html));
}

// An AI file is a PDF (Illustrator's "PDF Compatible File"), so SVG to AI
// draws the SVG as vectors into a PDF page of the drawing's size. Needs a DOM.
export async function svgToAi(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const doc = new DOMParser().parseFromString(svgMarkup(buf), "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
    throw new Error("This SVG file couldn't be read.");
  }
  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const length = (name: string, fallback: number) => {
    const value = parseFloat(svg.getAttribute(name) ?? "");
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const width = length("width", viewBox.length === 4 && viewBox[2]! > 0 ? viewBox[2]! : 300);
  const height = length("height", viewBox.length === 4 && viewBox[3]! > 0 ? viewBox[3]! : 150);

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({
    orientation: width > height ? "landscape" : "portrait",
    unit: "pt",
    format: [width, height],
    compress: true,
  });
  await svg2pdf(svg, pdf, { x: 0, y: 0, width, height });
  return pdf.output("arraybuffer");
}

function uuid(): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// A one-page EPUB 3 showing the image. The OCF container requires the
// "mimetype" entry first and stored, uncompressed.
export function imageToEpub(buf: ArrayBuffer, from: string, fileName: string): ArrayBuffer {
  const format = from.toLowerCase();
  const mediaType = EPUB_IMAGE_TYPES[format];
  if (!mediaType) throw new Error(`${from.toUpperCase()} can't go into an EPUB.`);
  const title = escapeXml(baseName(fileName));
  const image = `image.${format === "jpeg" ? "jpg" : format}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${uuid()}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="page" href="page.xhtml" media-type="application/xhtml+xml"/>
    <item id="image" href="${image}" media-type="${mediaType}"/>
  </manifest>
  <spine><itemref idref="page"/></spine>
</package>
`;
  const xhtml = (heading: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${heading}</title>
<style>body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}</style></head>
<body>${body}</body>
</html>
`;
  const nav = xhtml(
    title,
    `<nav epub:type="toc"><ol><li><a href="page.xhtml">${title}</a></li></ol></nav>`,
  );
  const page = xhtml(title, `<img src="${image}" alt="${title}"/>`);

  const zipped = zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/nav.xhtml": strToU8(nav),
    "OEBPS/page.xhtml": strToU8(page),
    [`OEBPS/${image}`]: [new Uint8Array(buf), { level: 0 }],
  });
  return toArrayBuffer(zipped);
}

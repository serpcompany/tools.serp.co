// Images into document formats (issue #147, Lane 3): SVG to an HTML page,
// SVG to a vector AI file, and an image to a one-page EPUB. Raster AI and PCD
// are written by encode.ts; this module covers the outputs that aren't a
// re-encoded raster. Its EPUB package (writeEpub) also holds a PDF's text
// (pdf-text.ts, #282).

import { strToU8, zipSync, type Zippable } from "fflate";

import { EPUB_IMAGE_TYPES } from "./image-document-targets.ts";

export { isImageDocumentConversion } from "./image-document-targets.ts";

// What XML 1.0 doesn't allow in a document: C0 controls other than tab, LF
// and CR, lone surrogates, and U+FFFE and U+FFFF. A surrogate pair is
// matched first, and kept.
// eslint-disable-next-line no-control-regex -- the control characters are what it removes
const XML_FORBIDDEN = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/g;

// `value` without the characters XML forbids, so any text can go in an XML
// or XHTML file and the file still parses.
export const xmlChars = (value: string) =>
  value.replace(XML_FORBIDDEN, (match) => (match.length === 2 ? match : ""));

// Text for XML or HTML content or a quoted attribute: no forbidden
// characters, and no markup.
export const escapeXml = (value: string) =>
  xmlChars(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "") || "image";

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

// The <svg> element and what follows it, without the XML declaration,
// doctype or comments before it, which HTML doesn't allow there. An "<svg"
// inside a comment doesn't count.
function svgMarkup(buf: ArrayBuffer): string {
  const source = new TextDecoder().decode(buf);
  const blanked = source.replace(/<!--[\s\S]*?-->/g, (comment) => " ".repeat(comment.length));
  const start = blanked.search(/<svg[\s>/]/i);
  if (start === -1) throw new Error("This file has no SVG drawing in it.");
  return source.slice(start).trim();
}

// Points per unit. One SVG user unit (or px) is one point, as Illustrator
// reads and writes SVG. Percentages have no absolute size.
const POINTS_PER_UNIT: Record<string, number> = {
  "": 1, px: 1, pt: 1, pc: 12, in: 72, cm: 72 / 2.54, mm: 72 / 25.4,
};

function points(value: string | null): number | undefined {
  const match = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(value ?? "");
  const factor = match ? POINTS_PER_UNIT[match[2]!.toLowerCase()] : undefined;
  const result = factor === undefined ? undefined : Number(match![1]) * factor;
  return result && result > 0 ? result : undefined;
}

// The drawing's size in points: width and height when they're absolute, a
// missing side from the viewBox's aspect ratio, else the viewBox itself.
export function svgPageSize(attributes: {
  width: string | null;
  height: string | null;
  viewBox: string | null;
}): { width: number; height: number } {
  const box = (attributes.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  const view = box.length === 4 && box[2]! > 0 && box[3]! > 0 ? { width: box[2]!, height: box[3]! } : undefined;
  let width = points(attributes.width);
  let height = points(attributes.height);
  if (width && !height && view) height = (width * view.height) / view.width;
  if (height && !width && view) width = (height * view.width) / view.height;
  return { width: width ?? view?.width ?? 300, height: height ?? view?.height ?? 150 };
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
  // The whole file, doctype included: Illustrator's SVG exports declare
  // entities there (&ns_ai;) that the drawing uses.
  svgMarkup(buf);
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(buf), "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
    throw new Error("This SVG file couldn't be read.");
  }
  const { width, height } = svgPageSize({
    width: svg.getAttribute("width"),
    height: svg.getAttribute("height"),
    viewBox: svg.getAttribute("viewBox"),
  });

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

// One XHTML document of an EPUB, in OEBPS/: its manifest id and file name,
// its title (plain text), which the table of contents lists it under, and
// its body, XHTML whose text the caller has escaped.
export type EpubDocument = { id: string; href: string; title: string; body: string };
// A file the documents use, such as an image, stored as it is.
export type EpubResource = { id: string; href: string; mediaType: string; bytes: Uint8Array };

// An EPUB 3 package: each document in the spine in order, and in the table
// of contents. The OCF container requires the "mimetype" entry first and
// stored, uncompressed. `title` and `language` (a BCP 47 tag) are plain text.
export function writeEpub(book: {
  title: string;
  language: string;
  style: string;
  documents: EpubDocument[];
  resources?: EpubResource[];
}): ArrayBuffer {
  const title = escapeXml(book.title);
  const language = escapeXml(book.language);
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const resources = book.resources ?? [];

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;
  const item = (id: string, href: string, mediaType: string) =>
    `    <item id="${escapeXml(id)}" href="${escapeXml(href)}" media-type="${escapeXml(mediaType)}"/>\n`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${uuid()}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${book.documents.map((doc) => item(doc.id, doc.href, "application/xhtml+xml")).join("")}${resources
    .map((resource) => item(resource.id, resource.href, resource.mediaType))
    .join("")}  </manifest>
  <spine>${book.documents.map((doc) => `<itemref idref="${escapeXml(doc.id)}"/>`).join("")}</spine>
</package>
`;
  const xhtml = (heading: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}">
<head><meta charset="utf-8"/><title>${heading}</title>
<style>${book.style}</style></head>
<body>${body}</body>
</html>
`;
  const toc = book.documents
    .map((doc) => `<li><a href="${escapeXml(doc.href)}">${escapeXml(doc.title)}</a></li>`)
    .join("");
  const files: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/nav.xhtml": strToU8(xhtml(title, `<nav epub:type="toc"><ol>${toc}</ol></nav>`)),
  };
  for (const doc of book.documents) files[`OEBPS/${doc.href}`] = strToU8(xhtml(escapeXml(doc.title), doc.body));
  for (const resource of resources) files[`OEBPS/${resource.href}`] = [resource.bytes, { level: 0 }];
  return toArrayBuffer(zipSync(files));
}

// A one-page EPUB 3 showing the image.
export function imageToEpub(buf: ArrayBuffer, from: string, fileName: string): ArrayBuffer {
  const format = from.toLowerCase();
  const mediaType = EPUB_IMAGE_TYPES[format];
  if (!mediaType) throw new Error(`${from.toUpperCase()} can't go into an EPUB.`);
  const title = baseName(fileName);
  const image = `image.${format === "jpeg" ? "jpg" : format}`;
  return writeEpub({
    title,
    language: "en",
    style: "body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}",
    documents: [{ id: "page", href: "page.xhtml", title, body: `<img src="${image}" alt="${escapeXml(title)}"/>` }],
    resources: [{ id: "image", href: image, mediaType, bytes: new Uint8Array(buf) }],
  });
}

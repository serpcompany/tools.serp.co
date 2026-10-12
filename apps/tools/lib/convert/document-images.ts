// DOCX, DXF and HTML files drawn as images (issue #250), in the visitor's
// browser and on the main thread, since laying out a page needs the DOM.
// HTML and DOCX are laid out in a sandboxed iframe that runs no script and
// loads nothing, then captured with modern-screenshot; DXF is drawn by
// dxf-viewer with three.js and WebGL. Each picture is encoded as any image
// is (encode.ts). Each library loads only when its input is converted:
// workerClient.ts imports this module only for these conversions
// (isDocumentImageConversion in image-document-targets.ts).

import { encodeFromRGBA } from "./encode.ts";
import type { RGBA } from "./heif.ts";
import type { ConversionResult, ProgressUpdate } from "./workerClient.ts";

// No side of an image is longer: Safari's canvas limit, as for PDF pages.
export const MAX_IMAGE_SIDE = 4096;
// An HTML page is laid out in a window this wide and this high (for `vh`
// units), and pictured as tall as its content, up to MAX_IMAGE_SIDE.
export const HTML_WIDTH = 1280;
export const HTML_VIEWPORT_HEIGHT = 800;
// A DOCX page is pictured at twice its size in points, as a PDF page is:
// 1.5 pixels a CSS pixel (96 a inch), 1224x1584 for US Letter.
export const DOCX_SCALE = 1.5;
// A DXF drawing has no size in pixels: its longer side is drawn this long,
// and its shorter side is never shorter than DXF_MIN_SIDE.
export const DXF_LONG_SIDE = 2048;
export const DXF_MIN_SIDE = 128;
// The drawing's margin, a share of its width and height.
const DXF_PADDING = 0.05;
// DejaVu Sans, self-hosted for table PDFs (table-outputs.ts), draws DXF TEXT
// and MTEXT too: Latin, Greek, Cyrillic, Hebrew and Arabic.
export const DXF_FONT_URL = "/vendor/fonts/dejavu/DejaVuSans.ttf";

// The policy every sandboxed page starts with: inline styles, and images
// and fonts held in the file itself (data: URLs). Nothing is fetched from
// this site or any other, and no form posts anywhere.
export const SANDBOX_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const POLICY_META = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_POLICY}">`;

// The iframe's srcdoc: the doctype (which decides standards or quirks mode),
// then the policy, before anything in the page, then the page. The parser
// puts the policy first in <head> and merges the page's <html> and <head>
// into the ones it opened. An empty doctype keeps a page without one in
// quirks mode, as browsers show it.
export function buildSrcdoc(html: string, doctype = "<!DOCTYPE html>"): string {
  const safeDoctype = doctype === "" || /^<!DOCTYPE [^<>]*>$/i.test(doctype) ? doctype : "<!DOCTYPE html>";
  return `${safeDoctype}${POLICY_META}${html}`;
}

// The encoding an HTML file names, as browsers find it: a byte order mark,
// then a <meta> charset in the first 1024 bytes, else UTF-8. A label
// TextDecoder doesn't know is read as UTF-8.
export function htmlCharset(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  const label = /<meta\b[^>]*?charset\s*=\s*["']?\s*([\w.:+-]+)/i.exec(head)?.[1];
  if (!label) return "utf-8";
  try {
    // UTF-16 named in an ASCII-compatible file can't be right; browsers read UTF-8.
    const encoding = new TextDecoder(label).encoding;
    return encoding.startsWith("utf-16") ? "utf-8" : encoding;
  } catch {
    return "utf-8";
  }
}

// What the visitor's HTML loses before it's laid out: anything that runs,
// loads, navigates or embeds another page. The sandbox and the policy stop
// them anyway; removing them keeps a refresh or a prefetch from even being
// tried. Images, inline styles and data: fonts stay.
const REMOVED_ELEMENTS = [
  "script",
  "base",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "link",
  "meta[http-equiv]",
].join(",");

export function sanitizeHtml(root: Document | DocumentFragment): void {
  for (const element of Array.from(root.querySelectorAll(REMOVED_ELEMENTS))) element.remove();
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const { name } of Array.from(element.attributes)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on") || lower === "ping" || lower === "srcdoc") element.removeAttribute(name);
    }
    if (element.localName === "img") element.setAttribute("loading", "eager");
    // A template's content is a separate tree that querySelectorAll doesn't
    // enter, and the page's parser can turn it into a shadow root.
    if (element.localName === "template" && "content" in element) {
      sanitizeHtml((element as HTMLTemplateElement).content);
    }
  }
  stopCaptureLoads(root);
}

// What modern-screenshot would load itself, from this page and outside the
// sandbox's policy, or wait for forever. Run on the parsed file, and again
// on the sandbox's document before the capture, since the sandbox parses
// the page again and attaches its declarative shadow roots.
// - Media can't play in a picture, and the capture would load a video's
//   poster from this page, or wait for a video that never loads. A video
//   becomes an image of its poster when the file holds it, else an empty
//   box of its size; audio goes.
// - An SVG <use> that points into another file would be fetched; one that
//   points into this page ("#icon") stays.
export function stopCaptureLoads(root: Document | DocumentFragment | ShadowRoot): void {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (element.localName === "audio") element.remove();
    else if (element.localName === "video") replaceVideo(element);
    else if (element.localName === "use") {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.localName !== "href") continue;
        const reference = inPageReference(attribute.value);
        if (reference === null) element.removeAttributeNode(attribute);
        else attribute.value = reference;
      }
    }
    if (element.shadowRoot) stopCaptureLoads(element.shadowRoot);
  }
}

// An href as the URL parser reads it (entities are decoded already): tabs
// and line breaks anywhere and spaces and control characters at either end
// don't count. The reference when it points into the page ("#icon"), else
// null. modern-screenshot reads the attribute as written (" #icon" names
// the file " "), so a reference kept is written back without them.
export function inPageReference(value: string): string | null {
  const text = value.replace(/[\t\n\r]/g, "");
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end -= 1;
  const reference = text.slice(start, end);
  return reference.startsWith("#") ? reference : null;
}

function replaceVideo(video: Element): void {
  const image = video.ownerDocument.createElement("img");
  for (const { name, value } of Array.from(video.attributes)) {
    if (["id", "class", "style", "title", "width", "height"].includes(name.toLowerCase())) image.setAttribute(name, value);
  }
  if (!image.hasAttribute("width")) image.setAttribute("width", "300");
  if (!image.hasAttribute("height")) image.setAttribute("height", "150");
  const poster = video.getAttribute("poster")?.trim() ?? "";
  if (poster.startsWith("data:")) image.setAttribute("src", poster);
  image.setAttribute("alt", "");
  video.replaceWith(image);
}

// ------------------------------------------------------------ geometry --

// The size of a DXF drawing's image: its aspect ratio, DXF_LONG_SIDE on the
// longer side and at least DXF_MIN_SIDE on the shorter (a single line or
// a long, thin part). A drawing with no extent (a point) is square.
export function drawingImageSize(width: number, height: number): { width: number; height: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  if (!w && !h) return { width: DXF_LONG_SIDE, height: DXF_LONG_SIDE };
  const short = (ratio: number) => Math.min(DXF_LONG_SIDE, Math.max(DXF_MIN_SIDE, Math.round(DXF_LONG_SIDE * ratio)));
  return w >= h
    ? { width: DXF_LONG_SIDE, height: short(h / w) }
    : { width: short(w / h), height: DXF_LONG_SIDE };
}

// The scale a page of this many CSS pixels is pictured at: `preferred`, or
// less when a side would pass MAX_IMAGE_SIDE.
export function pageScale(width: number, height: number, preferred: number): number {
  return Math.min(preferred, MAX_IMAGE_SIDE / Math.max(width, 1), MAX_IMAGE_SIDE / Math.max(height, 1));
}

// Where a page that runs past its bottom (`limit`) continues: the index of
// the first block (paragraph, table or table row) whose bottom is below it,
// given each block's bottom in order; null when everything fits. 0 means
// the page's first block runs past it, which stays on the page (only a
// table's rows can split), so a block taller than a page isn't moved on
// forever.
export function overflowIndex(bottoms: number[], limit: number): number | null {
  const index = bottoms.findIndex((bottom) => bottom > limit + 0.5);
  return index === -1 ? null : index;
}

// The row a table continues from on the next page, given `index`, its
// first row below the page's end (overflowIndex), and how many rows at its
// top are header rows, repeated on each page. A row after the headers must
// stay, else the whole table moves to the next page (null); a table that
// already starts its page keeps that one row, however tall, and continues
// after it. null as well when the table fits or has no row to move.
export function splitRow(index: number | null, headers: number, rows: number, startsPage: boolean): number | null {
  if (index === null) return null;
  const split = index > headers ? index : startsPage ? headers + 1 : null;
  return split !== null && split < rows ? split : null;
}

// A table cell as the browser lays it out: its spans, and whether it's
// shown. docx-preview keeps the cells a vertically merged cell covers, hidden.
export type GridCell = { rowSpan: number; colSpan: number; hidden: boolean };

// How many rows a cell in row `row` of `rows` covers: rowspan 0 runs to the
// end, and no span runs past it.
function rowsCovered(cell: GridCell, row: number, rows: number): number {
  return Math.min(cell.rowSpan > 0 ? cell.rowSpan : rows, rows - row);
}

// The grid column each cell starts in, -1 for a hidden one: a cell takes the
// first column a cell above doesn't still cover.
export function gridColumns(rows: ReadonlyArray<ReadonlyArray<GridCell>>): number[][] {
  const covered: number[] = [];
  return rows.map((cells, row) => {
    let column = 0;
    const starts = cells.map((cell) => {
      if (cell.hidden) return -1;
      while ((covered[column] ?? 0) > 0) column += 1;
      const start = column;
      const span = Math.max(1, cell.colSpan);
      for (let offset = 0; offset < span; offset += 1) covered[start + offset] = rowsCovered(cell, row, rows.length);
      column += span;
      return start;
    });
    for (let index = 0; index < covered.length; index += 1) covered[index] = Math.max(0, (covered[index] ?? 0) - 1);
    return starts;
  });
}

// The cells that start above row `split` and cover it too, by column: where
// each is (row and cell index), its column, and how many of its rows are
// above and below the split.
export function spansAcross(
  rows: ReadonlyArray<ReadonlyArray<GridCell>>,
  columns: number[][],
  split: number,
): Array<{ row: number; cell: number; column: number; above: number; below: number }> {
  const spans: Array<{ row: number; cell: number; column: number; above: number; below: number }> = [];
  rows.slice(0, split).forEach((cells, row) =>
    cells.forEach((cell, index) => {
      const end = row + rowsCovered(cell, row, rows.length);
      if (!cell.hidden && end > split) {
        spans.push({ row, cell: index, column: columns[row]![index]!, above: split - row, below: end - split });
      }
    }),
  );
  return spans.sort((a, b) => a.column - b.column);
}

// Each column's width from the x of the column edges the cells show,
// `edges[i]` being the left of column i; an edge no cell shows (every row
// spans it) is placed evenly between the edges either side.
export function columnWidths(edges: ReadonlyArray<number | undefined>): number[] {
  const known = edges.flatMap((x, index) => (x === undefined ? [] : [index]));
  const at = (index: number): number => {
    const before = known.filter((k) => k <= index).at(-1);
    const after = known.find((k) => k >= index);
    if (before === undefined) return edges[after!]!;
    if (after === undefined || after === before) return edges[before]!;
    return edges[before]! + ((edges[after]! - edges[before]!) * (index - before)) / (after - before);
  };
  if (!known.length) return [];
  return Array.from({ length: edges.length - 1 }, (_, index) => Math.max(0, at(index + 1) - at(index)));
}

// ------------------------------------------------------------ counters --

// docx-preview numbers list paragraphs with CSS counters in ::before content
// (`counter(docx-num-1-0, decimal) "."`), which modern-screenshot can't
// copy: it drops counter() and pictures "1." as ".". So the numbers are
// worked out here and written into the content as text. docx-preview's
// counters are simple (reset once on the root, set by the paragraph a level
// up, incremented by each item), so counting through the page in order
// gives what the browser shows.

// counter-reset, counter-set or counter-increment's computed value as
// name/value pairs; `fallback` when a name has no number.
export function counterPairs(value: string, fallback: number): Array<[string, number]> {
  if (!value || value === "none") return [];
  const pairs: Array<[string, number]> = [];
  for (const token of value.trim().split(/\s+/)) {
    if (/^[+-]?\d+$/.test(token) && pairs.length) pairs[pairs.length - 1]![1] = Number(token);
    else pairs.push([token, fallback]);
  }
  return pairs;
}

function roman(value: number): string {
  if (value < 1 || value > 3999) return String(value);
  const numerals: Array<[number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let rest = value;
  let text = "";
  for (const [size, numeral] of numerals) {
    while (rest >= size) {
      text += numeral;
      rest -= size;
    }
  }
  return text;
}

function alphabetic(value: number): string {
  if (value < 1) return String(value);
  let rest = value;
  let text = "";
  while (rest > 0) {
    rest -= 1;
    text = String.fromCharCode(97 + (rest % 26)) + text;
    rest = Math.floor(rest / 26);
  }
  return text;
}

// A counter's value in a list-style-type. Styles not listed here (CJK,
// Hebrew and other scripts) are shown as decimal numbers.
export function counterText(value: number, style = "decimal"): string {
  switch (style) {
    case "none":
      return "";
    case "decimal-leading-zero":
      return value >= 0 && value < 10 ? `0${value}` : String(value);
    case "lower-alpha":
    case "lower-latin":
      return alphabetic(value);
    case "upper-alpha":
    case "upper-latin":
      return alphabetic(value).toUpperCase();
    case "lower-roman":
      return roman(value);
    case "upper-roman":
      return roman(value).toUpperCase();
    default:
      return String(value);
  }
}

// A computed `content` value with its counter() and counters() calls
// replaced by their values, as plain text; quoted strings keep their CSS
// escapes' characters (`"\9 "` is a tab).
export function resolveCounterContent(content: string, counters: ReadonlyMap<string, number>): string {
  const unescape = (text: string) =>
    text.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([\s\S]))/g, (_, hex: string | undefined, char: string | undefined) =>
      hex ? String.fromCodePoint(parseInt(hex, 16) || 0xfffd) : (char ?? ""),
    );
  let text = "";
  const tokens = /"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|counters?\(\s*([^,)\s]+)\s*(?:,\s*("[^"]*"|'[^']*'|[^,)\s]+)\s*)?(?:,\s*([^,)\s]+)\s*)?\)/g;
  for (const match of content.matchAll(tokens)) {
    const [whole, double, single, name, second, third] = match;
    if (double !== undefined || single !== undefined) {
      text += unescape(double ?? single ?? "");
      continue;
    }
    const value = counters.get(name ?? "") ?? 0;
    // counters(name, "sep", style) has the style third; counter(name, style) second.
    const style = whole.startsWith("counters") ? third : second;
    text += counterText(value, style?.replace(/^["']|["']$/g, ""));
  }
  return text;
}

function cssString(text: string): string {
  return `"${text.replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ")}"`;
}

// Writes each ::before that shows a counter as the text it shows.
function resolveCounters(doc: Document): void {
  const view = doc.defaultView!;
  const counters = new Map<string, number>();
  const apply = (style: CSSStyleDeclaration) => {
    for (const [name, value] of counterPairs(style.getPropertyValue("counter-reset"), 0)) counters.set(name, value);
    for (const [name, value] of counterPairs(style.getPropertyValue("counter-increment"), 1)) {
      counters.set(name, (counters.get(name) ?? 0) + value);
    }
    for (const [name, value] of counterPairs(style.getPropertyValue("counter-set"), 0)) counters.set(name, value);
  };
  const rules: string[] = [];
  for (const element of [doc.documentElement, ...Array.from(doc.documentElement.querySelectorAll("*"))]) {
    apply(view.getComputedStyle(element));
    const before = view.getComputedStyle(element, "::before");
    apply(before);
    const content = before.getPropertyValue("content");
    if (!content.includes("counter")) continue;
    element.setAttribute("data-counter", String(rules.length));
    rules.push(`[data-counter="${rules.length}"]::before { content: ${cssString(resolveCounterContent(content, counters))} !important; }`);
  }
  if (!rules.length) return;
  const style = doc.createElement("style");
  style.textContent = rules.join("\n");
  doc.head.append(style);
}

export function htmlCutNotice(fullHeight: number, shownHeight: number): string {
  const px = (value: number) => value.toLocaleString("en-US");
  return `The page is ${px(fullHeight)} px tall: the image shows its first ${px(shownHeight)} px, the most an image can be.`;
}

// ------------------------------------------------------------- browser --

// A transparent pixel, which modern-screenshot draws for any image that
// isn't in the file itself.
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type Sandbox = { doc: Document; dispose: () => void };

// An off-screen iframe that runs no script (no allow-scripts) and that this
// page can read (allow-same-origin), holding `srcdoc`.
async function openSandbox(srcdoc: string, width: number, height: number): Promise<Sandbox> {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, {
    position: "fixed",
    left: "-30000px",
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
    border: "0",
    pointerEvents: "none",
  });
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  frame.srcdoc = srcdoc;
  document.body.append(frame);
  await loaded;
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error("The page couldn't be laid out in this browser.");
  }
  return { doc, dispose: () => frame.remove() };
}

// Waits until the page's images (data: URLs; the policy blocks the rest)
// and fonts are ready, or 10 s.
async function settle(doc: Document): Promise<void> {
  const images = Array.from(doc.images, (image) => (image.complete ? null : image.decode().catch(() => {})));
  const ready = Promise.all([...images, doc.fonts?.ready]);
  await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 10_000))]);
}

// The page's @font-face rules whose fonts are in the file itself (data:
// URLs, or local() fonts), for the capture to embed. Rules naming any other
// URL are left out: the policy blocked them, and modern-screenshot would
// fetch them from this page otherwise.
function embeddedFontFaces(doc: Document): string {
  const rules: string[] = [];
  const visit = (list: CSSRuleList) => {
    for (const rule of Array.from(list)) {
      if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
      if (!rule.cssText.startsWith("@font-face")) continue;
      const urls = [...rule.cssText.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)].map((match) => match[2] ?? "");
      if (urls.every((url) => url.startsWith("data:"))) rules.push(rule.cssText);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      // A sheet that can't be read has nothing this page could embed.
    }
  }
  // A non-empty value stops modern-screenshot reading the sheets itself.
  return rules.join("\n") || "/* no embedded fonts */";
}

// Pictures `node` (in a sandbox) `width` x `height` CSS pixels at `scale`, on
// white. modern-screenshot copies it into an SVG foreignObject, with each
// image in the file inlined, and draws that on a canvas. Its fetches run in
// this page, outside the sandbox's policy, so fetchFn answers every image
// that isn't a data: URL with a blank one instead, and fonts come only from
// embeddedFontFaces.
async function capture(
  node: HTMLElement,
  { width, height, scale, fonts }: { width: number; height: number; scale: number; fonts: string },
): Promise<RGBA> {
  const { domToCanvas } = await import("modern-screenshot");
  const canvas = await domToCanvas(node, {
    width,
    height,
    scale,
    backgroundColor: "#ffffff",
    font: { cssText: fonts },
    fetchFn: async (url) => (url.startsWith("data:") ? false : BLANK_IMAGE),
    fetch: {
      requestInit: { mode: "same-origin", credentials: "omit", cache: "force-cache" },
      placeholderImage: BLANK_IMAGE,
    },
    timeout: 15_000,
  });
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) throw new Error("The page couldn't be pictured in this browser.");
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return { data, width: canvas.width, height: canvas.height };
}

// ---------------------------------------------------------------- HTML --

// How tall the page is: its scrolling height when that's taller than the
// window, else the height of its content, so a short page isn't padded out
// to the window with blank space.
function pageHeight(doc: Document): number {
  const root = doc.documentElement;
  if (root.scrollHeight > HTML_VIEWPORT_HEIGHT) return root.scrollHeight;
  let bottom = root.getBoundingClientRect().bottom;
  if (doc.body) {
    const margin = parseFloat(doc.defaultView!.getComputedStyle(doc.body).marginBottom) || 0;
    bottom = Math.max(bottom, doc.body.getBoundingClientRect().top + doc.body.scrollHeight + margin);
  }
  return Math.max(1, Math.ceil(bottom));
}

// A browser paints the body's background over the whole window when the
// root has none, but the capture draws each box as it is: the background
// moves to the root, which is made as tall as the picture.
const BACKGROUND = [
  "background-color",
  "background-image",
  "background-repeat",
  "background-position",
  "background-size",
  "background-origin",
  "background-clip",
] as const;
function fillCanvas(doc: Document, height: number): void {
  const root = doc.documentElement;
  const view = doc.defaultView!;
  const painted = (style: CSSStyleDeclaration) =>
    style.backgroundImage !== "none" || !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor);
  if (doc.body && !painted(view.getComputedStyle(root))) {
    const body = view.getComputedStyle(doc.body);
    if (painted(body)) {
      for (const property of BACKGROUND) root.style.setProperty(property, body.getPropertyValue(property));
      doc.body.style.setProperty("background", "none");
    }
  }
  root.style.setProperty("min-height", `${height}px`);
}

async function renderHtml(buf: ArrayBuffer): Promise<{ rgba: RGBA; notice?: string }> {
  const bytes = new Uint8Array(buf);
  const text = new TextDecoder(htmlCharset(bytes)).decode(bytes);
  if (!text.trim()) throw new Error("This HTML file is empty.");
  // A parsed document runs nothing and loads nothing.
  const parsed = new DOMParser().parseFromString(text, "text/html");
  sanitizeHtml(parsed);
  const doctype = parsed.doctype ? new XMLSerializer().serializeToString(parsed.doctype) : "";
  const sandbox = await openSandbox(
    buildSrcdoc(parsed.documentElement.outerHTML, doctype),
    HTML_WIDTH,
    HTML_VIEWPORT_HEIGHT,
  );
  try {
    stopCaptureLoads(sandbox.doc);
    await settle(sandbox.doc);
    const root = sandbox.doc.documentElement;
    const fullHeight = pageHeight(sandbox.doc);
    const height = Math.min(fullHeight, MAX_IMAGE_SIDE);
    fillCanvas(sandbox.doc, height);
    const rgba = await capture(root, { width: HTML_WIDTH, height, scale: 1, fonts: embeddedFontFaces(sandbox.doc) });
    return { rgba, notice: fullHeight > height ? htmlCutNotice(fullHeight, height) : undefined };
  } finally {
    sandbox.dispose();
  }
}

// ---------------------------------------------------------------- DOCX --

// Each DOCX page docx-preview renders is a <section class="docx">, the page
// size and margins in its style, holding an optional <header>, an <article>
// for each part of the page in its own section of the document, footnotes,
// and an optional <footer>. Pages break where the file says (page and
// section breaks, "page break before"); a page whose content runs past its
// height (Word breaks those as it lays them out) continues on a new page,
// between paragraphs or table rows, with the header and footer repeated.
function continuePage(page: HTMLElement): HTMLElement | null {
  const style = page.ownerDocument.defaultView!.getComputedStyle(page);
  const pageHeight = parseFloat(style.minHeight);
  if (!(pageHeight > 0) || page.getBoundingClientRect().height <= pageHeight + 1) return null;
  const footer = page.querySelector<HTMLElement>(":scope > footer");
  const limit =
    page.getBoundingClientRect().top +
    pageHeight -
    (parseFloat(style.paddingBottom) || 0) -
    (footer?.getBoundingClientRect().height ?? 0);
  // Text in columns doesn't run straight down the page: such a part moves whole.
  const blocks = Array.from(page.querySelectorAll<HTMLElement>(":scope > article")).flatMap((article) =>
    article.style.columnCount ? [article] : (Array.from(article.children) as HTMLElement[]),
  );
  // A paragraph's space after counts: it pushes the page's end down too.
  const view = page.ownerDocument.defaultView!;
  const index = overflowIndex(
    blocks.map((block) => block.getBoundingClientRect().bottom + (parseFloat(view.getComputedStyle(block).marginBottom) || 0)),
    limit,
  );
  if (index === null) return null;
  // A table that runs past the page continues on the next from its first
  // row that doesn't fit. Any other block moves whole, unless it's the first
  // on the page: a block taller than a page stays on its own page.
  let first: Element | undefined = blocks[index];
  const continued = first?.localName === "table" ? splitTable(first as HTMLTableElement, limit, index === 0) : null;
  if (continued) first = continued;
  else if (index === 0) first = blocks[1];
  if (!first) return null;

  const next = page.cloneNode(false) as HTMLElement;
  const header = page.querySelector(":scope > header");
  if (header) next.append(header.cloneNode(true));
  let rest: ChildNode | null = first;
  if (first.parentElement !== page) {
    const article = first.parentElement!;
    const continued = article.cloneNode(false);
    for (let node: ChildNode | null = first; node; ) {
      const following: ChildNode | null = node.nextSibling;
      continued.appendChild(node);
      node = following;
    }
    next.append(continued);
    rest = article.nextSibling;
  }
  for (let node = rest; node; ) {
    const following: ChildNode | null = node.nextSibling;
    if (node !== footer) next.appendChild(node);
    node = following;
  }
  if (footer) {
    page.append(footer.cloneNode(true));
    next.append(footer);
  }
  page.after(next);
  return next;
}

// Header rows (Word's "repeat as header row"), marked as docx-preview lays
// the file out (markHeaderRows).
const HEADER_ROW_CLASS = "docx-repeated-header";

// Moves the rows of `table` from the first one below `limit` (splitRow) into
// a copy of the table placed after it, and returns the copy; null when the
// table doesn't split. The copy starts with the table's header rows. A cell
// merged down across the split ends at it, and continues, empty, in a cell
// of the same columns on the copy, as Word draws it; so every cell of the
// copy stays in its column, and both parts keep the columns the whole table
// was laid out with (a table sized to its content would size each part to
// its own rows).
function splitTable(table: HTMLTableElement, limit: number, startsPage: boolean): HTMLTableElement | null {
  const rows = Array.from(table.rows);
  let headers = 0;
  while (headers < rows.length && rows[headers]!.classList.contains(HEADER_ROW_CLASS)) headers += 1;
  const split = splitRow(overflowIndex(rows.map((row) => row.getBoundingClientRect().bottom), limit), headers, rows.length, startsPage);
  if (split === null) return null;

  const view = table.ownerDocument.defaultView!;
  const cells = rows.map((row) => Array.from(row.cells));
  const grid = cells.map((row) =>
    row.map((cell) => ({ rowSpan: cell.rowSpan, colSpan: cell.colSpan, hidden: view.getComputedStyle(cell).display === "none" })),
  );
  const columns = gridColumns(grid);
  const box = table.getBoundingClientRect();
  const edges: Array<number | undefined> = [];
  cells.forEach((row, r) =>
    row.forEach((cell, c) => {
      const column = columns[r]![c]!;
      if (column < 0) return;
      const { left, right } = cell.getBoundingClientRect();
      edges[column] ??= left - box.left;
      edges[column + grid[r]![c]!.colSpan] ??= right - box.left;
    }),
  );
  const widths = columnWidths(edges);

  for (const span of spansAcross(grid, columns, split)) {
    const cell = cells[span.row]![span.cell]!;
    cell.rowSpan = span.above;
    const continued = cell.cloneNode(false) as HTMLTableCellElement;
    continued.removeAttribute("id");
    continued.rowSpan = span.below;
    const after = cells[split]!.find((_, c) => columns[split]![c]! > span.column);
    rows[split]!.insertBefore(continued, after ?? null);
  }
  const rest = table.cloneNode(false) as HTMLTableElement;
  rest.removeAttribute("id");
  const body = table.ownerDocument.createElement("tbody");
  rows.slice(0, headers).forEach((row, r) => {
    const copy = row.cloneNode(true) as HTMLTableRowElement;
    for (const element of Array.from(copy.querySelectorAll("[id]"))) element.removeAttribute("id");
    // A header cell merged down past the headers ends with them.
    for (const cell of Array.from(copy.cells)) cell.rowSpan = Math.min(cell.rowSpan || headers, headers - r);
    body.append(copy);
  });
  for (const row of rows.slice(split)) body.append(row);
  rest.append(body);
  table.after(rest);
  for (const part of [table, rest]) {
    for (const group of Array.from(part.querySelectorAll(":scope > colgroup"))) group.remove();
    const group = part.ownerDocument.createElement("colgroup");
    for (const width of widths) {
      const column = part.ownerDocument.createElement("col");
      column.style.width = `${width}px`;
      group.append(column);
    }
    part.prepend(group);
    part.style.tableLayout = "fixed";
    part.style.width = `${box.width}px`;
  }
  return rest;
}

// The parts of a parsed DOCX (docx-preview's document model) that hold
// tables: a table's children are its rows, a row's its cells.
type DocxNode = { type?: string; children?: DocxNode[]; isHeader?: boolean | null; className?: string };

// Marks the rows at the top of each table that Word repeats on each page
// (w:tblHeader), which docx-preview reads but doesn't show, with
// HEADER_ROW_CLASS, which it renders as the row's class. docx-preview reads
// <w:tblHeader/>, with no value, as null: it means true.
function markHeaderRows(node: DocxNode | undefined): void {
  if (!node?.children) return;
  if (node.type === "table") {
    for (const row of node.children) {
      if (row.type !== "row" || !("isHeader" in row) || row.isHeader === false) break;
      row.className = row.className ? `${row.className} ${HEADER_ROW_CLASS}` : HEADER_ROW_CLASS;
    }
  }
  for (const child of node.children) markHeaderRows(child);
}

type HElement = { ns?: string; tagName: string; className?: string; style?: string | Record<string, string>; children?: Array<HElement | Node | string>; [key: string]: unknown };

// docx-preview builds each node with this, docx-preview's own `h`, but in
// `doc` instead of this page's document. It sets each picture's source as it
// builds the page, before the page is placed anywhere: built in the
// sandbox's document, a picture loads under the sandbox's policy, which
// allows data: URLs only. Built in this page, a picture the file links to
// but doesn't hold (its source null) would request /null from this site.
function sandboxElements(doc: Document): (element: HElement | Node | string) => Node {
  const view = doc.defaultView!;
  const h = (element: HElement | Node | string): Node => {
    if (typeof element === "string") return doc.createTextNode(element);
    if (element instanceof view.Node || element instanceof Node) return element;
    const { ns, tagName, className, style, children, ...props } = element;
    if (tagName === "#fragment") {
      const fragment = doc.createDocumentFragment();
      for (const child of children ?? []) fragment.appendChild(h(child));
      return fragment;
    }
    if (tagName === "#comment") return doc.createComment(children ? String(children[0]) : "");
    const result = ns ? doc.createElementNS(ns, tagName) : doc.createElement(tagName);
    if (className) result.setAttribute("class", className);
    if (typeof style === "string") result.setAttribute("style", style);
    else if (style) Object.assign((result as HTMLElement).style, style);
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) (result as unknown as Record<string, unknown>)[key] = value;
    }
    for (const child of children ?? []) result.appendChild(h(child));
    return result;
  };
  return h;
}

// Dispatched on window with each DOCX page's element, laid out and before
// it's captured, for tests to read (scripts/smoke-browser.mjs).
export const DOCUMENT_PAGE_EVENT = "document-images:page";

async function* renderDocxPages(buf: ArrayBuffer): AsyncGenerator<RGBA, void, void> {
  const { parseAsync, renderDocument } = await import("docx-preview");
  const sandbox = await openSandbox(
    buildSrcdoc('<html><head></head><body style="margin:0"></body></html>'),
    HTML_WIDTH,
    HTML_VIEWPORT_HEIGHT,
  );
  try {
    const options = {
      inWrapper: false,
      breakPages: true,
      // Page breaks Word recorded as it last laid the file out are left to
      // continuePage, which breaks between paragraphs rather than inside one.
      ignoreLastRenderedPageBreak: true,
      // Images and embedded fonts as data: URLs, which the policy allows
      // and the capture can inline.
      useBase64URL: true,
      // An altChunk is a whole HTML page inside the file: left out.
      renderAltChunks: false,
      renderComments: false,
      renderChanges: false,
      h: sandboxElements(sandbox.doc),
    };
    try {
      // renderAsync, with the header rows marked between reading the file
      // and laying it out, and the page's policy left in place.
      const parsed = await parseAsync(new Blob([buf]), options);
      markHeaderRows(parsed?.documentPart?.body);
      for (const node of await renderDocument(parsed, options)) {
        (node.nodeName === "STYLE" ? sandbox.doc.head : sandbox.doc.body).appendChild(node);
      }
    } catch (error) {
      throw new Error(`This DOCX file couldn't be read (${error instanceof Error ? error.message : String(error)}).`);
    }
    await settle(sandbox.doc);
    resolveCounters(sandbox.doc);
    const pages = Array.from(sandbox.doc.body.querySelectorAll<HTMLElement>(":scope > section"));
    if (!pages.length) throw new Error("This DOCX file has no pages to show.");
    // A file that doesn't give its page size or margins (pandoc writes
    // none) is laid out as Word lays it out: US Letter, 1-inch margins.
    for (const page of pages) {
      if (!page.style.width) page.style.width = "8.5in";
      if (!page.style.minHeight) page.style.minHeight = "11in";
      for (const side of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const) {
        if (!page.style[side]) page.style[side] = "1in";
      }
    }
    const fonts = embeddedFontFaces(sandbox.doc);
    for (const first of pages) {
      for (let page: HTMLElement | null = first; page; ) {
        // What runs past this page moves to a new page after it first.
        const next = continuePage(page);
        window.dispatchEvent(new CustomEvent(DOCUMENT_PAGE_EVENT, { detail: page }));
        const box = page.getBoundingClientRect();
        const width = Math.ceil(box.width);
        const height = Math.ceil(box.height);
        yield await capture(page, { width, height, scale: pageScale(width, height, DOCX_SCALE), fonts });
        page = next;
      }
    }
  } finally {
    sandbox.dispose();
  }
}

// ----------------------------------------------------------------- DXF --

export const NO_WEBGL_MESSAGE =
  "This browser can't draw DXF files: they need WebGL, which is turned off or unavailable here. Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration on.";

async function renderDxf(buf: ArrayBuffer): Promise<RGBA> {
  const { DxfViewer } = await import("dxf-viewer");
  const container = document.createElement("div");
  Object.assign(container.style, { position: "fixed", left: "-30000px", top: "0", width: "1px", height: "1px", overflow: "hidden" });
  document.body.append(container);
  const url = URL.createObjectURL(new Blob([buf], { type: "image/vnd.dxf" }));
  let viewer: InstanceType<typeof DxfViewer> | null = null;
  try {
    viewer = new DxfViewer(container, {
      canvasWidth: DXF_MIN_SIDE,
      canvasHeight: DXF_MIN_SIDE,
      clearColor: DxfViewer.DefaultOptions.clearColor!.clone().setHex(0xffffff),
      clearAlpha: 1,
      // White entities (colour 7, "black or white") drawn black on white.
      colorCorrection: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    if (!viewer.HasRenderer()) {
      throw Object.assign(new Error(NO_WEBGL_MESSAGE), { code: "webgl_unavailable" });
    }
    viewer.GetRenderer()!.setPixelRatio(1);
    try {
      await viewer.Load({ url, fonts: [DXF_FONT_URL] });
    } catch (error) {
      throw new Error(`This DXF file couldn't be read (${error instanceof Error ? error.message : String(error)}).`);
    }
    const bounds = viewer.GetBounds();
    const origin = viewer.GetOrigin();
    if (!bounds) throw new Error("This DXF file has nothing drawn in it.");
    const size = drawingImageSize(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    viewer.SetSize(size.width, size.height);
    viewer.FitView(
      bounds.minX - origin.x,
      bounds.maxX - origin.x,
      bounds.minY - origin.y,
      bounds.maxY - origin.y,
      DXF_PADDING,
    );
    viewer.Render();
    const copy = document.createElement("canvas");
    copy.width = size.width;
    copy.height = size.height;
    const context = copy.getContext("2d");
    if (!context) throw new Error("Failed to create 2D canvas context.");
    context.drawImage(viewer.GetCanvas(), 0, 0);
    return { data: context.getImageData(0, 0, size.width, size.height).data, width: size.width, height: size.height };
  } finally {
    const renderer = viewer?.GetRenderer();
    viewer?.Destroy();
    // Browsers keep a few WebGL contexts at a time: give this one back now.
    renderer?.forceContextLoss();
    URL.revokeObjectURL(url);
    container.remove();
  }
}

// --------------------------------------------------------------- entry --

async function encode(rgba: RGBA, to: string, quality: number): Promise<ArrayBuffer> {
  const buffer = await (await encodeFromRGBA(to, rgba, quality)).arrayBuffer();
  if (to !== "tif" && to !== "tiff") return buffer;
  // ImageMagick writes a TIFF uncompressed, about 6 MB a Letter page; LZW,
  // as Compress TIFF writes it, is lossless and a fraction of that.
  const { compressImageWithMagick } = await import("./magickBrowser.ts");
  const compressed = await compressImageWithMagick(buffer, to, quality);
  return compressed.byteLength < buffer.byteLength ? compressed : buffer;
}

// One image per DOCX page (kind "multiple", like PDF pages), or one of a DXF
// drawing or an HTML page, in `to`'s format. Throws an Error whose `code`
// is set when the browser, not the file, is the reason.
export async function convertDocumentToImages(
  buf: ArrayBuffer,
  from: string,
  to: string,
  { quality = 0.85, onProgress }: { quality?: number; onProgress?: (update: ProgressUpdate) => void } = {},
): Promise<ConversionResult> {
  onProgress?.({ status: "processing", progress: 10 });
  if (from === "docx") {
    const buffers: ArrayBuffer[] = [];
    for await (const page of renderDocxPages(buf)) {
      buffers.push(await encode(page, to, quality));
      onProgress?.({ status: "processing", progress: Math.min(95, 20 + buffers.length * 5) });
    }
    onProgress?.({ status: "processing", progress: 100 });
    return { kind: "multiple", buffers };
  }
  if (from === "dxf") {
    const buffer = await encode(await renderDxf(buf), to, quality);
    onProgress?.({ status: "processing", progress: 100 });
    return { kind: "single", buffer };
  }
  if (from === "html") {
    const { rgba, notice } = await renderHtml(buf);
    const buffer = await encode(rgba, to, quality);
    onProgress?.({ status: "processing", progress: 100 });
    return { kind: "single", buffer, notice };
  }
  throw new Error(`${from.toUpperCase()} files can't be drawn as images here.`);
}

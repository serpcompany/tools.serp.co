// SVG to TTF (issue #251): an SVG icon becomes a TrueType font of one glyph,
// on U+E000, the first Private Use Area code point, where icon fonts put
// theirs so an icon never stands in for a letter. The font family is named
// after the file.
//
// svg-font-shapes.ts reads the file's filled shapes; svgicons2svgfont
// flattens each, with its transforms, into one path; this module fills each
// shape by its own fill rule and joins them (a font fills by the nonzero
// rule, across every contour of the glyph); svg2ttf writes the TrueType
// file, which is read back before it is saved. Loaded only when an SVG is
// converted to TTF (workerClient.ts).

import { Readable } from "stream";
import svg2ttf from "svg2ttf";
import { SVGIcons2SVGFontStream } from "svgicons2svgfont";
import { SVGPathData } from "svg-pathdata";

import { SVG_FONT_MAX_BYTES, SVG_FONT_TOO_LARGE_MESSAGE } from "./image-document-targets.ts";
import {
  TOO_COMPLEX_MESSAGE,
  readSvgShapes,
  svgFontError,
  type LeftOut,
  type SvgShape,
} from "./svg-font-shapes.ts";

export const SVG_FONT_CODE_POINT = 0xe000;

// The font's metrics, as Fontello's (and svg2ttf's defaults): the SVG's
// artboard fills the em, 1,000 units tall, 150 of them below the baseline,
// so the icon sits on a line of text like a capital with a descender. A
// wide artboard makes a wide glyph, up to MAX_ADVANCE.
export const UNITS_PER_EM = 1000;
export const ASCENT = 850;
export const DESCENT = 150;
const MAX_ADVANCE = 16_000;
// TrueType stores coordinates as 16-bit integers.
const MAX_COORDINATE = 32_000;
// Work allowed for finding which contours hold which: box comparisons and
// polygon edges tested.
const NESTING_BUDGET = 100_000_000;

// The family name: the file's name without its extension, in plain ASCII
// letters, digits, spaces, hyphens and underscores (svg2ttf writes names
// for Macs as raw bytes, and some Windows apps cut a family name at 31
// characters), or "Icon" when nothing is left.
export function fontFamilyName(fileName: string): string {
  const stem = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  const ascii = stem
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31)
    .trim();
  return ascii || "Icon";
}

// The PostScript name: the family without spaces (at most 63 characters,
// ASCII, no spaces).
function postScriptName(family: string): string {
  return family.replace(/[^A-Za-z0-9_-]/g, "") || "Icon";
}

// What the page tells the visitor about the font: where the icon is, and
// what the SVG had that a font can't hold.
export function svgFontNotice(family: string, leftOut: LeftOut): string {
  const parts = [
    `The icon is character U+E000 of the font "${family}": in HTML &#xE000;, in CSS content: "\\e000".`,
  ];
  const missing = [
    leftOut.strokes && "strokes",
    leftOut.text && "text",
    leftOut.pictures && "embedded pictures",
  ].filter(Boolean) as string[];
  if (missing.length) {
    const list = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0];
    parts.push(`Left out, as a font holds filled shapes only: ${list}.`);
  }
  return parts.join(" ");
}

export const STROKES_ONLY_MESSAGE =
  "This SVG draws only with strokes (lines), and a font holds filled shapes. Convert the strokes to outlines " +
  "in your editor (Outline Stroke in Illustrator and Figma, Stroke to Path in Inkscape) and try again.";
export const TEXT_ONLY_MESSAGE =
  "This SVG holds only text, and a font holds filled shapes. Convert the text to outlines in your editor and try again.";
export const PICTURE_ONLY_MESSAGE =
  "This SVG holds only a picture (a bitmap), and a font holds filled shapes. Trace the picture into shapes in " +
  "your editor (Image Trace in Illustrator, Trace Bitmap in Inkscape) and try again.";
export const NOTHING_TO_DRAW_MESSAGE = "This SVG has no filled shapes to make a font from.";
export const OUTSIDE_ARTBOARD_MESSAGE =
  "This SVG's shapes are all outside its artboard (its viewBox), where a browser doesn't show them. " +
  "Move them onto the artboard and try again.";

// ---- Flattening ----

// Each shape as path data, flattened by svgicons2svgfont: absolute
// coordinates in the root's user units, y pointing up (y' = 1 - y).
async function flattenShapes(shapes: SvgShape[]): Promise<string[]> {
  const font = new SVGIcons2SVGFontStream({ fontName: "shapes", fontHeight: 1, normalize: false });
  let output = "";
  const done = new Promise<void>((resolve, reject) => {
    font.on("data", (chunk: unknown) => {
      output += String(chunk);
    });
    font.on("end", () => resolve());
    font.on("error", reject);
  });
  shapes.forEach((shape, index) => {
    const icon = new Readable({ read() {} }) as Readable & { metadata?: unknown };
    icon.push(shape.svg);
    icon.push(null);
    // Names and code points only tell the shapes apart here.
    icon.metadata = { name: `s${index}`, unicode: [String.fromCodePoint(0xf0000 + index)] };
    font.write(icon);
  });
  font.end();
  await done;
  const paths: string[] = new Array(shapes.length).fill("");
  for (const match of output.matchAll(/<glyph glyph-name="s(\d+)"[^>]*?\sd="([^"]*)"/g)) {
    paths[Number(match[1])] = match[2]!;
  }
  return paths;
}

// ---- Contours ----

type Point = { x: number; y: number };
type Segment = { to: Point; c1?: Point; c2?: Point };
type Contour = {
  start: Point;
  segments: Segment[];
  // For working out which contour holds which: the outline as a polygon
  // (curves sampled), its signed area (positive when counterclockwise, y
  // up) and its bounds.
  polygon: Point[];
  area: number;
  box: { minX: number; minY: number; maxX: number; maxY: number };
};

const CURVE_SAMPLES = 8;

function cubicAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}

function finishContour(start: Point, segments: Segment[]): Contour | null {
  if (!segments.length) return null;
  const polygon: Point[] = [start];
  let previous = start;
  for (const segment of segments) {
    if (segment.c1 && segment.c2) {
      for (let step = 1; step <= CURVE_SAMPLES; step += 1) {
        polygon.push(cubicAt(previous, segment.c1, segment.c2, segment.to, step / CURVE_SAMPLES));
      }
    } else {
      polygon.push(segment.to);
    }
    previous = segment.to;
  }
  let area = 0;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  // Measured from the start, so a small contour far from the origin keeps
  // its precision.
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    area += (a.x - start.x) * (b.y - start.y) - (b.x - start.x) * (a.y - start.y);
    box.minX = Math.min(box.minX, a.x);
    box.minY = Math.min(box.minY, a.y);
    box.maxX = Math.max(box.maxX, a.x);
    box.maxY = Math.max(box.maxY, a.y);
  }
  // A contour with no width or no height (a line, a point) fills nothing.
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  if (!(size > 0) || box.maxX - box.minX <= size * 1e-9 || box.maxY - box.minY <= size * 1e-9) return null;
  if (!polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  return { start, segments, polygon, area: area / 2, box };
}

// Path data (absolute or not, any commands) as closed contours of lines
// and cubic curves.
function contoursOf(d: string): Contour[] {
  const commands = new SVGPathData(d).toAbs().normalizeHVZ(false).normalizeST().qtToC().aToC().commands;
  const contours: Contour[] = [];
  let start: Point | null = null;
  let segments: Segment[] = [];
  let current: Point = { x: 0, y: 0 };
  let closed = false;
  const finish = () => {
    if (start) {
      const contour = finishContour(start, segments);
      if (contour) contours.push(contour);
    }
    segments = [];
  };
  for (const command of commands) {
    if (command.type === SVGPathData.MOVE_TO) {
      finish();
      start = { x: command.x, y: command.y };
      current = start;
      closed = false;
      continue;
    }
    if (command.type === SVGPathData.CLOSE_PATH) {
      if (start) current = start;
      closed = true;
      continue;
    }
    // A drawing command after Z starts a new contour where the last began.
    if (closed && start) {
      finish();
      start = { ...current };
      closed = false;
    }
    if (command.type === SVGPathData.LINE_TO) {
      current = { x: command.x, y: command.y };
      segments.push({ to: current });
    } else if (command.type === SVGPathData.CURVE_TO) {
      current = { x: command.x, y: command.y };
      segments.push({ c1: { x: command.x1, y: command.y1 }, c2: { x: command.x2, y: command.y2 }, to: current });
    }
  }
  finish();
  return contours;
}

function boxHolds(outer: Contour["box"], inner: Contour["box"]): boolean {
  return outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}

// Whether `point` is inside `polygon` (crossings of a ray to the right).
function inside(point: Point, polygon: Point[]): boolean {
  let crossings = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      crossings = !crossings;
    }
  }
  return crossings;
}

type Budget = { left: number };

// Whether `outer` holds `inner`: most of three of inner's points are inside
// it (one may sit on outer's edge, where a hole touches its outline).
function holds(outer: Contour, inner: Contour, budget: Budget): boolean {
  const points = inner.polygon;
  const picks = [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3)];
  budget.left -= picks.length * outer.polygon.length;
  if (budget.left < 0) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
  const votes = picks.filter((index) => inside(points[index]!, outer.polygon)).length;
  return votes >= 2;
}

function reversed(contour: Contour): Contour {
  const points = [contour.start, ...contour.segments.map((segment) => segment.to)];
  const segments: Segment[] = [];
  // The closing line, from the last point back to the start, comes first.
  const last = points.at(-1)!;
  if (last.x !== contour.start.x || last.y !== contour.start.y) segments.push({ to: last });
  for (let index = contour.segments.length - 1; index >= 0; index -= 1) {
    const segment = contour.segments[index]!;
    const to = points[index]!;
    segments.push(segment.c1 && segment.c2 ? { c1: segment.c2, c2: segment.c1, to } : { to });
  }
  return { ...contour, segments, area: -contour.area };
}

// One shape's contours, turned so that the nonzero rule fills exactly what
// the shape's own rule fills, with a winding number of one: an outline
// clockwise (as TrueType's are), a hole counterclockwise, and a contour
// that changes nothing left out. Every shape's filled area then counts the
// same, so where shapes overlap a font fills them all, as the SVG paints
// them, and a hole in one shape is a hole only where nothing else is drawn.
//
// Which contour holds which comes from the smallest contour around it.
// Contours of one shape that cross each other are taken as they are.
function normalizeContours(contours: Contour[], fillRule: "nonzero" | "evenodd", budget: Budget): Contour[] {
  const order = contours.map((_, index) => index).sort((a, b) => Math.abs(contours[a]!.area) - Math.abs(contours[b]!.area));
  const parent = new Array<number>(contours.length).fill(-1);
  // Only a larger contour can hold one; contours of the same size (a grid
  // of dots) aren't compared.
  let larger = 0;
  order.forEach((index, rank) => {
    const contour = contours[index]!;
    const size = Math.abs(contour.area);
    larger = Math.max(larger, rank + 1);
    while (larger < order.length && Math.abs(contours[order[larger]!]!.area) <= size) larger += 1;
    for (let next = larger; next < order.length; next += 1) {
      if ((budget.left -= 1) < 0) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
      const candidate = contours[order[next]!]!;
      if (!boxHolds(candidate.box, contour.box)) continue;
      if (holds(candidate, contour, budget)) {
        parent[index] = order[next]!;
        break;
      }
    }
  });
  // Outermost first, so a contour's parent is done before it.
  const winding = new Array<number>(contours.length).fill(0);
  const depth = new Array<number>(contours.length).fill(0);
  const target = new Array<number>(contours.length).fill(0);
  const result: Contour[] = [];
  for (const index of [...order].reverse()) {
    const contour = contours[index]!;
    const up = parent[index]! === -1 ? null : parent[index]!;
    winding[index] = (up === null ? 0 : winding[up]!) + (contour.area < 0 ? -1 : 1);
    depth[index] = (up === null ? 0 : depth[up]!) + 1;
    const filled = fillRule === "evenodd" ? depth[index]! % 2 === 1 : winding[index] !== 0;
    target[index] = filled ? 1 : 0;
    const turn = target[index]! - (up === null ? 0 : target[up]!);
    if (turn === 0) continue;
    // Clockwise (negative area, y up) adds one; counterclockwise takes one off.
    const clockwise = contour.area < 0;
    result.push((turn > 0) === clockwise ? contour : reversed(contour));
  }
  return result;
}

// ---- The font ----

type Box = { left: number; bottom: number; width: number; height: number };

function encodeContours(contours: Contour[], map: (point: Point) => Point): string {
  const round = (value: number) => String(Math.round(value * 100) / 100);
  const xy = (point: Point) => {
    const mapped = map(point);
    if (Math.abs(mapped.x) > MAX_COORDINATE || Math.abs(mapped.y) > MAX_COORDINATE) {
      throw svgFontError("too_complex", FAR_OUTSIDE_MESSAGE);
    }
    return `${round(mapped.x)} ${round(mapped.y)}`;
  };
  return contours
    .map(
      (contour) =>
        `M${xy(contour.start)}` +
        contour.segments.map((segment) => (segment.c1 && segment.c2 ? `C${xy(segment.c1)} ${xy(segment.c2)} ${xy(segment.to)}` : `L${xy(segment.to)}`)).join("") +
        "Z",
    )
    .join("");
}

export const FAR_OUTSIDE_MESSAGE =
  "This SVG draws far outside its artboard (its viewBox), farther than a font's glyph can reach. " +
  "Move or delete the shapes outside it and try again.";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The one glyph of `ttf` after the empty .notdef, read back: its contour
// and point counts. Throws when the glyph isn't one TrueType readers can
// read, such as when svg2ttf's flags overflow on a very detailed outline.
export function readGlyph(ttf: Uint8Array, glyphIndex = 1): { contours: number; points: number } {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const tables = new Map<string, { offset: number; length: number }>();
  const count = view.getUint16(4);
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    const tag = String.fromCharCode(...ttf.subarray(at, at + 4));
    tables.set(tag, { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
  }
  const head = tables.get("head");
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");
  if (!head || !loca || !glyf) throw new Error("no glyph tables");
  const long = view.getInt16(head.offset + 50) === 1;
  const offsetOf = (index: number) =>
    long ? view.getUint32(loca.offset + index * 4) : view.getUint16(loca.offset + index * 2) * 2;
  const start = glyf.offset + offsetOf(glyphIndex);
  const end = glyf.offset + offsetOf(glyphIndex + 1);
  if (!(end > start) || end > glyf.offset + glyf.length) throw new Error("the glyph is empty");
  const contours = view.getInt16(start);
  if (contours <= 0) throw new Error("the glyph has no simple outline");
  let at = start + 10;
  let previous = -1;
  for (let index = 0; index < contours; index += 1, at += 2) {
    const last = view.getUint16(at);
    if (last <= previous) throw new Error("the glyph's contour ends are out of order");
    previous = last;
  }
  const points = previous + 1;
  at += 2 + view.getUint16(at);
  let xBytes = 0;
  let yBytes = 0;
  for (let read = 0; read < points; ) {
    if (at >= end) throw new Error("the glyph's flags run past its end");
    const flag = ttf[at++]!;
    let repeat = 1;
    if (flag & 8) repeat += ttf[at++]!;
    const xSize = flag & 2 ? 1 : flag & 16 ? 0 : 2;
    const ySize = flag & 4 ? 1 : flag & 32 ? 0 : 2;
    xBytes += xSize * repeat;
    yBytes += ySize * repeat;
    read += repeat;
    if (read > points) throw new Error("the glyph's flags don't match its points");
  }
  const size = at + xBytes + yBytes - start;
  if (size > end - start || end - start - size >= 4) throw new Error("the glyph's coordinates don't match its flags");
  return { contours, points };
}

function decodeSvgText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder().decode(bytes);
}

export type SvgFontResult = { buffer: ArrayBuffer; family: string; notice: string };

// `buf`: the SVG file; `fileName`: its name, which names the font. Throws
// an Error with a `code` (svg-font-shapes.ts) for a file that is damaged,
// draws nothing a font can hold, or is too large or detailed; any other
// error is this converter's.
export async function svgToTtf(buf: ArrayBuffer, fileName: string): Promise<SvgFontResult> {
  if (buf.byteLength > SVG_FONT_MAX_BYTES) throw svgFontError("too_complex", SVG_FONT_TOO_LARGE_MESSAGE);
  const { artboard, shapes, leftOut, strokeOnly } = readSvgShapes(decodeSvgText(new Uint8Array(buf)));
  const family = fontFamilyName(fileName);
  const failNothing = (): never => {
    if (strokeOnly > 0) throw svgFontError("nothing_to_draw", STROKES_ONLY_MESSAGE);
    if (leftOut.text && !leftOut.pictures) throw svgFontError("nothing_to_draw", TEXT_ONLY_MESSAGE);
    if (leftOut.pictures && !leftOut.text) throw svgFontError("nothing_to_draw", PICTURE_ONLY_MESSAGE);
    throw svgFontError("nothing_to_draw", NOTHING_TO_DRAW_MESSAGE);
  };
  if (!shapes.length) failNothing();

  // svgicons2svgfont reads only what svg-font-shapes.ts wrote, so its
  // failure is this converter's, not the file's.
  const paths = await flattenShapes(shapes);

  const budget = { left: NESTING_BUDGET };
  const perShape = shapes.map((shape, index) => normalizeContours(contoursOf(paths[index]!), shape.fillRule, budget));
  // Off the artboard, a browser shows nothing: shapes wholly outside it
  // (an editor's spare parts) are left out of the glyph too.
  let box: Box;
  let contours = perShape.flat();
  if (artboard) {
    box = { left: artboard.x, bottom: 1 - artboard.y - artboard.height, width: artboard.width, height: artboard.height };
    const drawn = contours.length;
    contours = contours.filter(
      (contour) =>
        contour.box.maxX > box.left &&
        contour.box.minX < box.left + box.width &&
        contour.box.maxY > box.bottom &&
        contour.box.minY < box.bottom + box.height,
    );
    if (drawn && !contours.length) throw svgFontError("nothing_to_draw", OUTSIDE_ARTBOARD_MESSAGE);
  } else {
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const { box: own } of contours) {
      bounds.minX = Math.min(bounds.minX, own.minX);
      bounds.minY = Math.min(bounds.minY, own.minY);
      bounds.maxX = Math.max(bounds.maxX, own.maxX);
      bounds.maxY = Math.max(bounds.maxY, own.maxY);
    }
    box = { left: bounds.minX, bottom: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
  }
  if (!contours.length || !(box.width > 0 && box.height > 0)) failNothing();
  if (contours.length > 30_000) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);

  const scale = Math.min(UNITS_PER_EM / box.height, MAX_ADVANCE / box.width);
  const advance = Math.max(1, Math.round(box.width * scale));
  const d = encodeContours(contours, (point) => ({
    x: (point.x - box.left) * scale,
    y: (point.y - box.bottom) * scale - DESCENT,
  }));
  const name = postScriptName(family);
  const svgFont =
    '<?xml version="1.0" standalone="no"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg"><defs>\n' +
    `<font id="${escapeXml(name)}" horiz-adv-x="${advance}">\n` +
    `<font-face font-family="${escapeXml(family)}" units-per-em="${UNITS_PER_EM}" ascent="${ASCENT}" descent="-${DESCENT}"/>\n` +
    '<missing-glyph horiz-adv-x="0"/>\n' +
    `<glyph glyph-name="uniE000" unicode="&#xE000;" horiz-adv-x="${advance}" d="${d}"/>\n` +
    "</font></defs></svg>\n";
  const ttf = svg2ttf(svgFont, {
    familyname: family,
    fullname: family,
    description: `An icon on U+E000, made from ${family}.svg with tools.serp.co SVG to TTF.`,
    url: "https://tools.serp.co/svg-to-ttf/",
    version: "1.0",
  });
  const bytes = new Uint8Array(ttf.buffer);
  try {
    readGlyph(bytes);
  } catch (error) {
    throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE, error);
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return { buffer, family, notice: svgFontNotice(family, { ...leftOut, strokes: leftOut.strokes || strokeOnly > 0 }) };
}

// SVG to TTF (issue #251): an SVG icon becomes a TrueType font of one glyph,
// on U+E000, the first Private Use Area code point, where icon fonts put
// theirs so an icon never stands in for a letter. The font family is named
// after the file.
//
// svg-font-shapes.ts reads the file's filled shapes; svgicons2svgfont
// flattens each, with its transforms, into one path; this module fills each
// shape by its own fill rule and joins them (a font fills by the nonzero
// rule, across every contour of the glyph; svg-font-regions.ts), with
// a boolean step, in a worker with a time limit, for a shape whose outlines
// cross (svg-font-boolean.ts); svg2ttf writes the TrueType
// file, which is read back before it is saved. Loaded only when an SVG is
// converted to TTF (workerClient.ts).

import { Readable } from "stream";
import svg2ttf from "svg2ttf";
import { SVGIcons2SVGFontStream } from "svgicons2svgfont";
import { SVGPathData } from "svg-pathdata";

import { SVG_FONT_MAX_BYTES, SVG_FONT_TOO_LARGE_MESSAGE } from "./image-document-targets.ts";
import type { RegionShape, RegionsJob, RegionsReply } from "./svg-font-boolean.ts";
import {
  MAX_CROSSINGS,
  MAX_GLYPH_POINTS,
  boundsOf,
  clockwise,
  findMeetings,
  finishContour,
  normalizeContours,
  polygonContour,
  polygonOf,
  reversed,
  ringOf,
  type Budget,
  type Contour,
  type FillRule,
  type Meetings,
  type Point,
  type Segment,
} from "./svg-font-regions.ts";
import {
  IDENTITY,
  TOO_COMPLEX_MESSAGE,
  UNREADABLE_SVG_MESSAGE,
  readSvgShapes,
  svgFontError,
  type LeftOut,
  type SvgShape,
} from "./svg-font-shapes.ts";
import { runInWorker, type WorkerLike } from "./worker-run.ts";

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

export const CROSSINGS_NOTICE =
    "Where this SVG's outlines cross, the font may fill in gaps the SVG leaves empty: the crossings were too many or too intricate to work out in the browser.";

// What the page tells the visitor about the font: where the icon is, what
// the SVG had that a font can't hold, and whether crossing outlines were
// taken as drawn (fillShapes).
export function svgFontNotice(family: string, leftOut: LeftOut, approximated = false): string {
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
  if (approximated) parts.push(CROSSINGS_NOTICE);
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

const outOfRange = (cause?: unknown) => svgFontError("number_out_of_range", UNREADABLE_SVG_MESSAGE, cause);

// finishContour, refusing a point past a double's range. svg-font-shapes.ts
// bounds every number, so this is only a backstop.
function checkedContour(start: Point, segments: Segment[]): Contour | null {
  const polygon = polygonOf(start, segments);
  if (!polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) throw outOfRange();
  return finishContour(start, segments, polygon);
}

// Path data (absolute or not, any commands) as closed contours of lines
// and cubic curves.
function contoursOf(d: string): Contour[] {
  let commands: SVGPathData["commands"];
  try {
    commands = new SVGPathData(d).toAbs().normalizeHVZ(false).normalizeST().qtToC().aToC().commands;
  } catch (error) {
    // svgicons2svgfont writes a number past a double's range as Infinity.
    if (/Infinity|NaN/.test(d)) throw outOfRange(error);
    throw error;
  }
  const contours: Contour[] = [];
  let start: Point | null = null;
  let segments: Segment[] = [];
  let current: Point = { x: 0, y: 0 };
  let closed = false;
  const finish = () => {
    if (start) {
      const contour = checkedContour(start, segments);
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

// `contour` with every point moved by `map`, an affine map, so its curves
// stay curves; null when it no longer encloses anything.
function mapContour(contour: Contour, map: (point: Point) => Point): Contour | null {
  return checkedContour(
    map(contour.start),
    contour.segments.map((segment) =>
      segment.c1 && segment.c2 ? { c1: map(segment.c1), c2: map(segment.c2), to: map(segment.to) } : { to: map(segment.to) },
    ),
  );
}

// ---- Filling each shape ----

// Work allowed on the page's thread for finding which contours hold which
// (edges and boxes compared, polygon edges tested), past which a file is
// refused as too detailed; and for finding where outlines cross (pairs of
// edges compared), past which a shape's outlines are taken as drawn.
const NESTING_BUDGET = 100_000_000;
const SWEEP_WORK = 50_000_000;
// How long the boolean step (svg-font-boolean.ts) may run in its worker.
export const REGIONS_TIMEOUT_MS = 5_000;

export type RegionsRunner = (job: RegionsJob) => Promise<RegionsReply>;

const startRegionsWorker = (): WorkerLike<RegionsReply> =>
  new Worker(new URL("./svg-font.worker.ts", import.meta.url), { type: "module" });

// The boolean step in a new worker, terminated when it answers, fails, or
// runs past `timeoutMs` (then the shapes it had are taken as drawn).
export function regionsInWorker({
  timeoutMs = REGIONS_TIMEOUT_MS,
  createWorker = startRegionsWorker,
}: { timeoutMs?: number; createWorker?: () => WorkerLike<RegionsReply> } = {}): RegionsRunner {
  return (job) =>
    runInWorker(createWorker(), job, {
      timeoutMs,
      timedOut: () => new Error(`The crossing outlines took over ${timeoutMs} ms to work out.`),
      crashed: (event) => new Error(`The crossing outlines worker stopped (${event.message || "out of memory"}).`),
      transfer: job.shapes.flatMap((shape) => shape.rings.map((ring) => ring.buffer)),
    });
}

// Where there is no Worker (Node, in tests): on this thread, unbounded.
const regionsInThread: RegionsRunner = async (job) => (await import("./svg-font-boolean.ts")).resolveRegions(job);

type Placed = { fillRule: FillRule; contours: Contour[] };

const allClockwise = (contours: Contour[]) => contours.map(clockwise);

// The shapes' contours, ready to join in one glyph: each shape's own region,
// by its own fill rule, with a winding of one inside it and none outside, so
// that no shape cuts into another where they overlap (normalizeContours).
// - Outlines that neither cross nor touch: their nesting says what fills.
// - A nonzero shape whose outlines meet, all running the same way round and
//   none meeting itself, never winds below zero: it is taken as drawn,
//   turned clockwise. So is a nonzero shape alone in the glyph, since the
//   font's rule is then its own.
// - Any other shape whose outlines meet (an even-odd star, two squares drawn
//   opposite ways) goes to the boolean step, in a worker with a time limit.
// A shape whose outlines meet more than MAX_CROSSINGS times, or more than a
// glyph's points once its curves are lines, or that the boolean step didn't
// finish within REGIONS_TIMEOUT_MS, is taken as drawn instead: the contours
// that meet clockwise, so they all fill, and the rest by their nesting
// (`approximated`: where outlines cross, gaps the SVG leaves may fill).
async function fillShapes(
  placed: Placed[],
  budget: Budget,
  regions: RegionsRunner,
): Promise<{ contours: Contour[]; approximated: boolean }> {
  const sweep = { left: SWEEP_WORK };
  const job: RegionShape[] = [];
  let approximated = false;
  type Plan = { done: Contour[] } | { job: number; shape: Placed; meetings: Meetings };
  const fallback = ({ contours, fillRule }: Placed, meetings: Meetings): Contour[] => {
    approximated = true;
    if (meetings.capped) return allClockwise(contours);
    return normalizeContours(contours, fillRule, budget, { outward: (index) => meetings.meeting.has(index) });
  };
  const plans = placed.map((shape): Plan => {
    const { contours, fillRule } = shape;
    const meetings = findMeetings(contours, MAX_CROSSINGS, sweep);
    if (!meetings.capped && !meetings.count) return { done: normalizeContours(contours, fillRule, budget) };
    if (fillRule === "nonzero") {
      const direction = Math.sign(contours[0]!.area);
      const sameWay = contours.every((contour) => Math.sign(contour.area) === direction);
      if (placed.length === 1) return { done: contours.reduce((sum, contour) => sum + contour.area, 0) > 0 ? contours.map(reversed) : contours };
      if (!meetings.capped && !meetings.selfMeet && sameWay) return { done: allClockwise(contours) };
    }
    if (meetings.capped) return { done: fallback(shape, meetings) };
    const rings = contours.map(ringOf);
    if (rings.reduce((sum, ring) => sum + ring.length / 2, 0) > MAX_GLYPH_POINTS) return { done: fallback(shape, meetings) };
    job.push({ fillRule, rings });
    return { job: job.length - 1, shape, meetings };
  });
  let reply: RegionsReply | null = null;
  if (job.length) {
    try {
      reply = await regions({ shapes: job });
    } catch {
      // Past its time limit, or the worker didn't load: every shape it had
      // is taken as drawn.
      reply = null;
    }
  }
  const contours: Contour[] = [];
  for (const plan of plans) {
    if ("done" in plan) {
      contours.push(...plan.done);
      continue;
    }
    const resolved = reply?.ok ? reply.shapes[plan.job] : undefined;
    if (resolved && "contours" in resolved) contours.push(...resolved.contours.flatMap((points) => polygonContour(points) ?? []));
    else contours.push(...fallback(plan.shape, plan.meetings));
  }
  return { contours, approximated };
}

// ---- The font ----

type Box = { left: number; bottom: number; width: number; height: number };

function encodeContours(contours: Contour[]): string {
  const round = (value: number) => String(Math.round(value * 100) / 100);
  const xy = (point: Point) => `${round(point.x)} ${round(point.y)}`;
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
export async function svgToTtf(
  buf: ArrayBuffer,
  fileName: string,
  // Where the boolean step runs: a worker with a time limit, unless there
  // is no Worker (Node).
  { regions }: { regions?: RegionsRunner } = {},
): Promise<SvgFontResult> {
  if (buf.byteLength > SVG_FONT_MAX_BYTES) throw svgFontError("too_complex", SVG_FONT_TOO_LARGE_MESSAGE);
  const { artboard, transform, shapes, leftOut, strokeOnly } = readSvgShapes(decodeSvgText(new Uint8Array(buf)));
  const family = fontFamilyName(fileName);
  const failNothing = (): never => {
    if (strokeOnly > 0) throw svgFontError("nothing_to_draw", STROKES_ONLY_MESSAGE);
    if (leftOut.text && !leftOut.pictures) throw svgFontError("nothing_to_draw", TEXT_ONLY_MESSAGE);
    if (leftOut.pictures && !leftOut.text) throw svgFontError("nothing_to_draw", PICTURE_ONLY_MESSAGE);
    throw svgFontError("nothing_to_draw", NOTHING_TO_DRAW_MESSAGE);
  };
  if (!shapes.length) failNothing();

  // svgicons2svgfont reads only what svg-font-shapes.ts wrote, so its
  // failure is this converter's, not the file's. Each shape's contours are
  // in the root's user units, y up (y' = 1 - y).
  const paths = await flattenShapes(shapes);
  let perShape = shapes.map((_, index) => contoursOf(paths[index]!));

  // Off the artboard, a browser shows nothing: contours wholly outside it
  // (an editor's spare parts) are left out of the glyph too, before the
  // root's own transform and after it (a turn about the box's corner can
  // take the drawing off it).
  let box: Box | null = null;
  const onArtboard = (frame: Box) => {
    const drawn = perShape.some((contours) => contours.length);
    // A contour that only touches the artboard's edge (to a billionth of
    // its size, as a turn's rounding leaves it) isn't seen either.
    const margin = Math.max(frame.width, frame.height) * 1e-9;
    perShape = perShape.map((contours) =>
      contours.filter(
        ({ box: own }) =>
          own.maxX > frame.left + margin &&
          own.minX < frame.left + frame.width - margin &&
          own.maxY > frame.bottom + margin &&
          own.minY < frame.bottom + frame.height - margin,
      ),
    );
    if (drawn && !perShape.some((contours) => contours.length)) throw svgFontError("nothing_to_draw", OUTSIDE_ARTBOARD_MESSAGE);
  };
  if (artboard) {
    box = { left: artboard.x, bottom: 1 - artboard.y - artboard.height, width: artboard.width, height: artboard.height };
    onArtboard(box);
  }
  // The root's own transform moves the drawing and its artboard together:
  // the drawing is moved, and the artboard stays the glyph's frame.
  if (transform.some((value, index) => value !== IDENTITY[index])) {
    const [a, b, c, d, e, f] = transform;
    const move = ({ x, y }: Point): Point => ({ x: a * x + c * (1 - y) + e, y: 1 - (b * x + d * (1 - y) + f) });
    perShape = perShape.map((contours) => contours.flatMap((contour) => mapContour(contour, move) ?? []));
    if (box) onArtboard(box);
  }
  if (!box) {
    const bounds = boundsOf(perShape.flat());
    box = { left: bounds.minX, bottom: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
  }
  if (!perShape.some((contours) => contours.length) || !(box.width > 0 && box.height > 0)) failNothing();

  // Font units from here: the artboard fills the em, its bottom left at
  // (0, -DESCENT).
  const scale = Math.min(UNITS_PER_EM / box.height, MAX_ADVANCE / box.width);
  if (!Number.isFinite(scale)) throw outOfRange();
  const advance = Math.max(1, Math.round(box.width * scale));
  const { left, bottom } = box;
  const toFont = ({ x, y }: Point): Point => {
    const point = { x: (x - left) * scale, y: (y - bottom) * scale - DESCENT };
    if (!(Math.abs(point.x) <= MAX_COORDINATE && Math.abs(point.y) <= MAX_COORDINATE)) {
      throw svgFontError("too_complex", FAR_OUTSIDE_MESSAGE);
    }
    return point;
  };
  const budget: Budget = { left: NESTING_BUDGET, exceeded: () => svgFontError("too_complex", TOO_COMPLEX_MESSAGE) };
  const placed = shapes
    .map((shape, index) => ({ fillRule: shape.fillRule, contours: perShape[index]!.flatMap((contour) => mapContour(contour, toFont) ?? []) }))
    .filter((shape) => shape.contours.length);
  const { contours, approximated } = await fillShapes(placed, budget, regions ?? (typeof Worker === "function" ? regionsInWorker() : regionsInThread));
  if (!contours.length) failNothing();
  if (contours.length > 30_000) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);

  const d = encodeContours(contours);
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
  return {
    buffer,
    family,
    notice: svgFontNotice(family, { ...leftOut, strokes: leftOut.strokes || strokeOnly > 0 }, approximated),
  };
}

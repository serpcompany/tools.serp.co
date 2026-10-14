// SVG to TTF (issue #251): an SVG icon becomes a TrueType font of one glyph,
// on U+E000, the first Private Use Area code point, where icon fonts put
// theirs so an icon never stands in for a letter. The font family is named
// after the file.
//
// svg-font-shapes.ts reads the file's filled shapes; svgicons2svgfont
// flattens each, with its transforms, into one path; this module fills each
// shape by its own fill rule and joins them (a font fills by the nonzero
// rule, across every contour of the glyph; svg-font-regions.ts), with a
// boolean step, in a worker with a time limit, for a shape whose outlines
// cross (svg-font-boolean.ts); outlines of straight lines are snapped to
// whole font units (snapRound); svg2ttf writes the TrueType file, which is
// read back before it is saved. Loaded only when an SVG is converted to
// TTF (workerClient.ts).

import { Readable } from "stream";
import svg2ttf from "svg2ttf";
import svg2ttfSteps from "svg2ttf/lib/ttf/utils.js";
import { SVGIcons2SVGFontStream } from "svgicons2svgfont";
import { SVGPathData } from "svg-pathdata";

import { SVG_FONT_MAX_BYTES, SVG_FONT_TOO_LARGE_MESSAGE } from "./image-document-targets.ts";
import type { RegionShape, RegionsJob, RegionsMessage, ResolvedShape } from "./svg-font-boolean.ts";
import {
  MAX_CROSSINGS,
  MAX_GLYPH_POINTS,
  boundsOf,
  cleanOutline,
  clockwise,
  findMeetings,
  finishContour,
  normalizeContours,
  polygonContour,
  polygonOf,
  reversed,
  ringOf,
  snapRound,
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
import type { WorkerLike } from "./worker-run.ts";

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

// Why some shapes were taken as drawn (fillShapes), each with what the
// page tells the visitor: their crossings were too many or too intricate
// (or took too long) to work out; there was too much to check whether they
// cross; or the browser couldn't run the step that works them out.
export const CROSSINGS_NOTICE =
  "Where this SVG's outlines cross, the font may fill in gaps the SVG leaves empty: the crossings were too many or too intricate to work out in the browser.";
export const UNCHECKED_NOTICE =
  "Some shapes had too many points to check in the browser whether their outlines cross, so they are filled as drawn: where they cross, the font may fill in gaps the SVG leaves empty.";
export const WORKER_FAILED_NOTICE =
  "Where this SVG's outlines cross, the font may fill in gaps the SVG leaves empty: this browser couldn't run the step that works them out. Try again, or try another browser.";
export type TakenAsDrawn = "crossings" | "unchecked" | "failed";
const TAKEN_AS_DRAWN_NOTICES: Record<TakenAsDrawn, string> = {
  crossings: CROSSINGS_NOTICE,
  unchecked: UNCHECKED_NOTICE,
  failed: WORKER_FAILED_NOTICE,
};

// What the page tells the visitor about the font: where the icon is, what
// the SVG had that a font can't hold, and why any shapes were taken as
// drawn (fillShapes).
export function svgFontNotice(family: string, leftOut: LeftOut, takenAsDrawn: Iterable<TakenAsDrawn> = []): string {
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
  const reasons = new Set(takenAsDrawn);
  for (const reason of ["crossings", "unchecked", "failed"] as const) {
    if (reasons.has(reason)) parts.push(TAKEN_AS_DRAWN_NOTICES[reason]);
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
// refused as too detailed.
const NESTING_BUDGET = 100_000_000;
// Work allowed on the page's thread for finding where outlines cross (pairs
// of edges compared), shared out among the shapes by their number of
// points, so that one large shape can't use up another's: each shape gets
// its share, and at least SWEEP_FLOOR (enough to compare every pair of a
// shape's edges up to about a hundred), so a file's total stays under
// SWEEP_WORK plus SWEEP_FLOOR for each of its at most 5,000 shapes. A shape
// whose own allowance runs out is taken as drawn on its own.
const SWEEP_WORK = 50_000_000;
const SWEEP_FLOOR = 5_000;
// How long the boolean step (svg-font-boolean.ts) may run in its worker.
export const REGIONS_TIMEOUT_MS = 5_000;

// Each shape the boolean step was given: its region, the reason it wasn't
// found, or nothing when the worker stopped before it (`stopped`: it ran
// past the time limit, or failed to start or crashed).
export type RegionsOutcome = { shapes: (ResolvedShape | undefined)[]; stopped: "timeout" | "failed" | null };
export type RegionsRunner = (job: RegionsJob) => Promise<RegionsOutcome>;

const startRegionsWorker = (): WorkerLike<RegionsMessage> =>
  new Worker(new URL("./svg-font.worker.ts", import.meta.url), { type: "module" });

// The boolean step in a new worker, which posts each shape's region as it
// finds it, terminated when it is done, fails, or runs past `timeoutMs`:
// the shapes it found by then are kept, and the rest are taken as drawn.
export function regionsInWorker({
  timeoutMs = REGIONS_TIMEOUT_MS,
  createWorker = startRegionsWorker,
}: { timeoutMs?: number; createWorker?: () => WorkerLike<RegionsMessage> } = {}): RegionsRunner {
  return (job) =>
    new Promise((resolve) => {
      const shapes: RegionsOutcome["shapes"] = new Array(job.shapes.length).fill(undefined);
      let worker: WorkerLike<RegionsMessage> | null = null;
      let settled = false;
      const finish = (stopped: RegionsOutcome["stopped"]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker?.terminate();
        resolve({ shapes, stopped });
      };
      const timer = setTimeout(() => finish("timeout"), timeoutMs);
      try {
        worker = createWorker();
      } catch {
        finish("failed");
        return;
      }
      worker.onmessage = ({ data }) => {
        if ("done" in data) finish(null);
        else shapes[data.index] = data.shape;
      };
      worker.onerror = () => finish("failed");
      try {
        worker.postMessage(job, job.shapes.flatMap((shape) => shape.rings.map((ring) => ring.buffer)));
      } catch {
        finish("failed");
      }
    });
}

// Where there is no Worker (Node, in tests): on this thread, each shape
// within its allowances but with no time limit.
const regionsInThread: RegionsRunner = async (job) => {
  const { resolveRegions } = await import("./svg-font-boolean.ts");
  return { shapes: resolveRegions(job), stopped: null };
};

type Placed = { fillRule: FillRule; contours: Contour[] };
// A shape's contours ready for the glyph, and which of them can be snapped
// to whole units together without crossing (snapRound): "shape" when none
// crosses another or itself (they may touch), "contour" when none crosses
// itself (each is snapped on its own), null when one may cross itself.
type Filled = { contours: Contour[]; snap: "shape" | "contour" | null };
const selfApart = (meetings: Meetings) => (meetings.stopped || meetings.selfMeet ? null : "contour");

const allClockwise = (contours: Contour[]) => contours.map(clockwise);

// The shapes' contours, ready to join in one glyph: each shape's own region,
// by its own fill rule, with a winding of one inside it and none outside, so
// that no shape cuts into another where they overlap (normalizeContours).
// Each shape is decided on its own:
// - Outlines that neither cross nor touch: their nesting says what fills.
// - A nonzero shape whose outlines meet, all running the same way round and
//   none meeting itself, never winds below zero: it is taken as drawn,
//   turned clockwise. So is a nonzero shape alone in the glyph, since the
//   font's rule is then its own.
// - Any other shape whose outlines meet (an even-odd star, two squares drawn
//   opposite ways) goes to the boolean step, in a worker with a time limit.
// A shape is taken as drawn instead (`takenAsDrawn` says why), the contours
// that meet clockwise, so they all fill, and the rest by their nesting:
// "crossings" when its outlines meet more than MAX_CROSSINGS times, or more
// than a glyph's points once its curves are lines, or the boolean step ran
// out of its allowances or time; "failed" when the worker didn't run; and
// "unchecked", every contour clockwise, when its own allowance for finding
// where its outlines cross ran out first.
async function fillShapes(
  placed: Placed[],
  budget: Budget,
  regions: RegionsRunner,
): Promise<{ shapes: Filled[]; takenAsDrawn: Set<TakenAsDrawn> }> {
  const job: RegionShape[] = [];
  const takenAsDrawn = new Set<TakenAsDrawn>();
  type Plan = { done: Filled } | { job: number; shape: Placed; meetings: Meetings };
  const fallback = ({ contours, fillRule }: Placed, meetings: Meetings, reason: TakenAsDrawn): Filled => {
    takenAsDrawn.add(reason);
    if (meetings.stopped) return { contours: allClockwise(contours), snap: null };
    const outward = (index: number) => meetings.meeting.has(index);
    return { contours: normalizeContours(contours, fillRule, budget, { outward }), snap: selfApart(meetings) };
  };
  const sizes = placed.map(({ contours }) => contours.reduce((sum, contour) => sum + contour.polygon.length, 0));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const plans = placed.map((shape, index): Plan => {
    const { contours, fillRule } = shape;
    const size = sizes[index]!;
    const allowance = Math.max((SWEEP_WORK * size) / total, Math.min(size + (size * (size - 1)) / 2, SWEEP_FLOOR));
    const meetings = findMeetings(contours, MAX_CROSSINGS, { left: allowance });
    if (!meetings.stopped && !meetings.count) return { done: { contours: normalizeContours(contours, fillRule, budget), snap: "shape" } };
    if (fillRule === "nonzero") {
      const direction = Math.sign(contours[0]!.area);
      const sameWay = contours.every((contour) => Math.sign(contour.area) === direction);
      if (placed.length === 1) {
        const net = contours.reduce((sum, contour) => sum + contour.area, 0);
        return { done: { contours: net > 0 ? contours.map(reversed) : contours, snap: selfApart(meetings) } };
      }
      if (!meetings.stopped && !meetings.selfMeet && sameWay) return { done: { contours: allClockwise(contours), snap: "contour" } };
    }
    if (meetings.stopped) return { done: fallback(shape, meetings, meetings.stopped === "work" ? "unchecked" : "crossings") };
    const rings = contours.map(ringOf);
    if (rings.reduce((sum, ring) => sum + ring.length / 2, 0) > MAX_GLYPH_POINTS) return { done: fallback(shape, meetings, "crossings") };
    job.push({ fillRule, rings });
    return { job: job.length - 1, shape, meetings };
  });
  let outcome: RegionsOutcome = { shapes: [], stopped: null };
  if (job.length) outcome = await regions({ shapes: job }).catch((): RegionsOutcome => ({ shapes: [], stopped: "failed" }));
  const shapes = plans.map((plan): Filled => {
    if ("done" in plan) return plan.done;
    const resolved = outcome.shapes[plan.job];
    if (resolved && "contours" in resolved) {
      return { contours: resolved.contours.flatMap((points) => polygonContour(points) ?? []), snap: "shape" };
    }
    return fallback(plan.shape, plan.meetings, !resolved && outcome.stopped === "failed" ? "failed" : "crossings");
  });
  return { shapes, takenAsDrawn };
}

// ---- The font ----

type Box = { left: number; bottom: number; width: number; height: number };

// Work allowed for snapping outlines of straight lines to whole font units
// (snapRound: cells and hot pixels looked at), past which the rest are
// rounded point by point.
const SNAP_WORK = 20_000_000;
class SnapWorkOut extends Error {}

function boundsOfPoints(points: Point[]): Contour["box"] {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { x, y } of points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

// The glyph's outlines as path data, in font units, and how many there are.
// Outlines of straight lines (all a boolean step's are) are in whole units:
// snapped (snapRound) where they can be, together as Filled.snap says, so
// none crosses another or itself, or else rounded point by point; each is
// cleaned (cleanOutline), so no segment has no length. Curves are written to
// a hundredth, for svg2ttf to turn into TrueType's quadratic curves and
// round (svg2ttfCleaned).
function encodeShapes(shapes: Filled[]): { d: string; count: number } {
  const snapWork: Budget = { left: SNAP_WORK, exceeded: () => new SnapWorkOut() };
  const round = (value: number) => String(Math.round(value * 100) / 100);
  const xy = (point: Point) => `${round(point.x)} ${round(point.y)}`;
  const rounded = (outlines: Point[][]) =>
    outlines.flatMap((outline) => {
      const cleaned = cleanOutline(outline.map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) })));
      return cleaned ? [cleaned] : [];
    });
  const snapped = (outlines: Point[][]) => {
    if (snapWork.left > 0) {
      try {
        return snapRound(outlines, snapWork);
      } catch (error) {
        if (!(error instanceof SnapWorkOut)) throw error;
      }
    }
    return rounded(outlines);
  };
  const parts: string[] = [];
  for (const { contours, snap } of shapes) {
    const isLines = (contour: Contour) => contour.segments.every((segment) => !segment.c1);
    const lines = contours.filter(isLines).map((contour) => [contour.start, ...contour.segments.map((segment) => segment.to)]);
    const whole = snap === "shape" ? snapped(lines) : snap === "contour" ? lines.flatMap((line) => snapped([line])) : rounded(lines);
    for (const outline of whole) parts.push(`M${outline.map(({ x, y }) => `${x} ${y}`).join("L")}Z`);
    for (const contour of contours) {
      if (isLines(contour)) continue;
      // A curve less than a unit wide or tall (with its control points)
      // would round to a point or a line: it draws nothing.
      const box = boundsOfPoints([contour.start, ...contour.segments.flatMap(({ c1, c2, to }) => (c1 && c2 ? [c1, c2, to] : [to]))]);
      if (box.maxX - box.minX < 1 || box.maxY - box.minY < 1) continue;
      parts.push(
        `M${xy(contour.start)}` +
          contour.segments.map((segment) => (segment.c1 && segment.c2 ? `C${xy(segment.c1)} ${xy(segment.c2)} ${xy(segment.to)}` : `L${xy(segment.to)}`)).join("") +
          "Z",
      );
    }
  }
  return { d: parts.join(""), count: parts.length };
}

type TtfPoint = { x: number; y: number; onCurve: boolean };

// A contour's TrueType points, rounded, without a point that repeats the
// one before it (cyclically): an on-curve point is kept over an off-curve
// one on the same spot, which leaves the same outline. At least one point
// is left, as svg2ttf counts the contour already.
function withoutRepeats(contour: TtfPoint[]): TtfPoint[] {
  const kept: TtfPoint[] = [];
  for (const point of contour) {
    const last = kept.at(-1);
    if (last && last.x === point.x && last.y === point.y) {
      if (!last.onCurve && point.onCurve) kept[kept.length - 1] = point;
      continue;
    }
    kept.push(point);
  }
  while (kept.length > 1 && kept[0]!.x === kept.at(-1)!.x && kept[0]!.y === kept.at(-1)!.y) {
    const last = kept.pop()!;
    if (!kept[0]!.onCurve && last.onCurve) kept[0] = last;
  }
  return kept;
}

// svg2ttf with two of its steps on a glyph's points changed (lib/ttf/
// utils.js, whose functions svg2ttf 6.1.0 looks up on that module each time
// it runs). Its `simplify` drops every point within 0.3 units of a straight
// line through its neighbours, before rounding: where an outline passes
// through a point twice, or touches itself, that can move one pass across
// the other. encodeShapes has already rounded and cleaned the outlines of
// straight lines, so `simplify` is skipped for them and still runs for
// curves. Its `roundPoints` can leave two points on one spot where a curve
// is under a unit long: those are merged (withoutRepeats).
function svg2ttfCleaned(svgFont: string, options: Parameters<typeof svg2ttf>[1]): ReturnType<typeof svg2ttf> {
  const { simplify, roundPoints } = svg2ttfSteps;
  const whole = (contour: TtfPoint[]) => contour.every((point) => point.onCurve && Number.isInteger(point.x) && Number.isInteger(point.y));
  svg2ttfSteps.simplify = (contours, accuracy) => contours.map((contour) => (whole(contour) ? contour : simplify([contour], accuracy)[0]!));
  svg2ttfSteps.roundPoints = (contours) => roundPoints(contours).map(withoutRepeats);
  try {
    return svg2ttf(svgFont, options);
  } finally {
    Object.assign(svg2ttfSteps, { simplify, roundPoints });
  }
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
  const filled = await fillShapes(placed, budget, regions ?? (typeof Worker === "function" ? regionsInWorker() : regionsInThread));
  const { d, count } = encodeShapes(filled.shapes);
  if (!count) failNothing();
  if (count > 30_000) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);

  const name = postScriptName(family);
  const svgFont =
    '<?xml version="1.0" standalone="no"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg"><defs>\n' +
    `<font id="${escapeXml(name)}" horiz-adv-x="${advance}">\n` +
    `<font-face font-family="${escapeXml(family)}" units-per-em="${UNITS_PER_EM}" ascent="${ASCENT}" descent="-${DESCENT}"/>\n` +
    '<missing-glyph horiz-adv-x="0"/>\n' +
    `<glyph glyph-name="uniE000" unicode="&#xE000;" horiz-adv-x="${advance}" d="${d}"/>\n` +
    "</font></defs></svg>\n";
  const ttf = svg2ttfCleaned(svgFont, {
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
    notice: svgFontNotice(family, { ...leftOut, strokes: leftOut.strokes || strokeOnly > 0 }, filled.takenAsDrawn),
  };
}

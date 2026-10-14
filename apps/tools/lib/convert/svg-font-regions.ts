// The geometry of SVG to TTF (svg-font.ts, issue #251): a shape's outlines
// as contours, which contour holds which, where outlines cross, and how each
// contour is turned so that the font's nonzero rule fills exactly what the
// shape's own fill rule fills. The worker that finds the region of crossing
// outlines (svg-font-boolean.ts) uses it too, so it imports no SVG or font
// library.

export type Point = { x: number; y: number };
export type Segment = { to: Point; c1?: Point; c2?: Point };
export type Contour = {
  start: Point;
  segments: Segment[];
  // For working out which contour holds which: the outline as a polygon
  // (curves sampled), its signed area (positive when counterclockwise, y
  // up) and its bounds.
  polygon: Point[];
  area: number;
  box: { minX: number; minY: number; maxX: number; maxY: number };
};
export type FillRule = "nonzero" | "evenodd";

// Work allowed, counted in edges and boxes compared or polygon edges
// tested. `exceeded` is the error thrown when it runs out.
export type Budget = { left: number; exceeded: () => Error };

export function spend(budget: Budget, work: number): void {
  budget.left -= work;
  if (budget.left < 0) throw budget.exceeded();
}

const CURVE_SAMPLES = 8;

function cubicAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}

// Whether all of `polygon` lies on one line (to a billionth of its length):
// an outline that encloses nothing.
function onOneLine(polygon: Point[]): boolean {
  const first = polygon[0]!;
  let far = first;
  let farthest = 0;
  for (const point of polygon) {
    const distance = (point.x - first.x) ** 2 + (point.y - first.y) ** 2;
    if (distance > farthest) {
      farthest = distance;
      far = point;
    }
  }
  const dx = far.x - first.x;
  const dy = far.y - first.y;
  return polygon.every((point) => Math.abs(dx * (point.y - first.y) - dy * (point.x - first.x)) <= farthest * 1e-9);
}

// The polygon of a contour starting at `start` (its curves sampled).
export function polygonOf(start: Point, segments: Segment[]): Point[] {
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
  return polygon;
}

// A closed contour, or null when it encloses nothing. Its points must be
// finite numbers (svg-font.ts checks those it reads).
export function finishContour(start: Point, segments: Segment[], polygon = polygonOf(start, segments)): Contour | null {
  if (!segments.length) return null;
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
  // A contour with no width or no height (a line, a point), or whose points
  // are all on one line, fills nothing.
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  if (!(size > 0) || box.maxX - box.minX <= size * 1e-9 || box.maxY - box.minY <= size * 1e-9) return null;
  if (onOneLine(polygon)) return null;
  return { start, segments, polygon, area: area / 2, box };
}

// The bounds of all of `contours`.
export function boundsOf(contours: Contour[]): Contour["box"] {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { box } of contours) {
    bounds.minX = Math.min(bounds.minX, box.minX);
    bounds.minY = Math.min(bounds.minY, box.minY);
    bounds.maxX = Math.max(bounds.maxX, box.maxX);
    bounds.maxY = Math.max(bounds.maxY, box.maxY);
  }
  return bounds;
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

// Whether `outer` holds `inner`: most of three of inner's points are inside
// it (one may sit on outer's edge, where a hole touches its outline).
function holds(outer: Contour, inner: Contour, budget: Budget): boolean {
  const points = inner.polygon;
  const picks = [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3)];
  spend(budget, picks.length * outer.polygon.length);
  const votes = picks.filter((index) => inside(points[index]!, outer.polygon)).length;
  return votes >= 2;
}

export function reversed(contour: Contour): Contour {
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

// `contour` running clockwise (y up), as TrueType's outlines do: winding +1
// inside it.
export function clockwise(contour: Contour): Contour {
  return contour.area > 0 ? reversed(contour) : contour;
}

// Each contour's parent: the smallest contour around it, or -1. Only a
// larger contour can hold one; contours of the same size (a grid of dots)
// aren't compared. `order`: the contours from smallest to largest.
function nestContours(contours: Contour[], budget: Budget): { parent: number[]; order: number[] } {
  const order = contours.map((_, index) => index).sort((a, b) => Math.abs(contours[a]!.area) - Math.abs(contours[b]!.area));
  const parent = new Array<number>(contours.length).fill(-1);
  let larger = 0;
  order.forEach((index, rank) => {
    const contour = contours[index]!;
    const size = Math.abs(contour.area);
    larger = Math.max(larger, rank + 1);
    while (larger < order.length && Math.abs(contours[order[larger]!]!.area) <= size) larger += 1;
    for (let next = larger; next < order.length; next += 1) {
      spend(budget, 1);
      const candidate = contours[order[next]!]!;
      if (!boxHolds(candidate.box, contour.box)) continue;
      if (holds(candidate, contour, budget)) {
        parent[index] = order[next]!;
        break;
      }
    }
  });
  return { parent, order };
}

// A shape's contours, none crossing or touching another, turned so that the
// nonzero rule fills exactly what `fillRule` fills, with a winding number of
// one: an outline clockwise (as TrueType's are), a hole counterclockwise,
// and a contour that changes nothing left out. Every shape's filled area
// then counts the same, and none counts less than nothing, so where shapes
// overlap a font fills them all, as the SVG paints them, and a hole in one
// shape is a hole only where nothing else is drawn.
//
// `outward`: contours taken as outlines whatever they hold, clockwise and
// filled (the fallback for outlines that cross, svg-font.ts). The winding
// still never goes below zero: a contour that crosses none sits wholly in
// its parent, and takes off at most the one its parent adds.
export function normalizeContours(
  contours: Contour[],
  fillRule: FillRule,
  budget: Budget,
  { outward }: { outward?: (index: number) => boolean } = {},
): Contour[] {
  const { parent, order } = nestContours(contours, budget);
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
    if (outward?.(index)) {
      target[index] = 1;
      result.push(clockwise(contour));
      continue;
    }
    const filled = fillRule === "evenodd" ? depth[index]! % 2 === 1 : winding[index] !== 0;
    target[index] = filled ? 1 : 0;
    const turn = target[index]! - (up === null ? 0 : target[up]!);
    if (turn === 0) continue;
    // Clockwise (negative area, y up) adds one; counterclockwise takes one off.
    const isClockwise = contour.area < 0;
    result.push((turn > 0) === isClockwise ? contour : reversed(contour));
  }
  return result;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function within(a: Point, b: Point, point: Point): boolean {
  return (
    Math.min(a.x, b.x) <= point.x &&
    point.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= point.y &&
    point.y <= Math.max(a.y, b.y)
  );
}

// Whether the segments ab and cd cross or touch.
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = orientation(c, d, a);
  const d2 = orientation(c, d, b);
  const d3 = orientation(a, b, c);
  const d4 = orientation(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && within(c, d, a)) ||
    (d2 === 0 && within(c, d, b)) ||
    (d3 === 0 && within(a, b, c)) ||
    (d4 === 0 && within(a, b, d))
  );
}

// Where a shape's contours cross or touch one another or themselves (by
// their polygons: curves sampled): how many times, up to `cap`; whether a
// contour meets itself; and which contours meet any. `stopped` when the
// sweep stopped before it finished, and `meeting` is incomplete:
// "crossings" when the count reached `cap`, "work" when it ran out of
// `work` (pairs of edges compared, the shape's own allowance), so that how
// often its outlines cross isn't known. Edges are swept along the drawing's
// longer side.
export type Meetings = { count: number; stopped: "crossings" | "work" | null; selfMeet: boolean; meeting: Set<number> };

export function findMeetings(contours: Contour[], cap: number, work: { left: number }): Meetings {
  const found: Meetings = { count: 0, stopped: null, selfMeet: false, meeting: new Set() };
  const bounds = boundsOf(contours);
  const alongX = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
  type Edge = { contour: number; index: number; count: number; a: Point; b: Point; low: number; high: number; from: number; to: number };
  const edges: Edge[] = [];
  for (const [which, contour] of contours.entries()) {
    const points = contour.polygon.filter((point, index, all) => {
      const next = all[(index + 1) % all.length]!;
      return point.x !== next.x || point.y !== next.y;
    });
    work.left -= points.length;
    if (work.left < 0) return { ...found, stopped: "work" };
    points.forEach((a, index) => {
      const b = points[(index + 1) % points.length]!;
      const [u1, u2, v1, v2] = alongX ? [a.x, b.x, a.y, b.y] : [a.y, b.y, a.x, b.x];
      edges.push({ contour: which, index, count: points.length, a, b, low: Math.min(u1, u2), high: Math.max(u1, u2), from: Math.min(v1, v2), to: Math.max(v1, v2) });
    });
  }
  edges.sort((e, f) => e.low - f.low);
  for (let i = 0; i < edges.length; i += 1) {
    const e = edges[i]!;
    for (let j = i + 1; j < edges.length && edges[j]!.low <= e.high; j += 1) {
      if ((work.left -= 1) < 0) return { ...found, stopped: "work" };
      const f = edges[j]!;
      if (f.from > e.to || f.to < e.from) continue;
      // Neighbouring edges of one contour share their corner.
      const gap = Math.abs(e.index - f.index);
      if (e.contour === f.contour && (gap === 1 || gap === e.count - 1)) continue;
      if (!segmentsMeet(e.a, e.b, f.a, f.b)) continue;
      found.count += 1;
      found.meeting.add(e.contour).add(f.contour);
      if (e.contour === f.contour) found.selfMeet = true;
      if (found.count >= cap) return { ...found, stopped: "crossings" };
    }
  }
  return found;
}

// Crossings and touches in one shape past which it is taken as drawn,
// without the boolean step (svg-font-boolean.ts): its work and its outline
// grow with them, and a glyph's 65,535 points hold only so many.
export const MAX_CROSSINGS = 10_000;

// The boolean step works on polygons: a curve becomes enough straight steps
// to keep within FLATNESS font units of it (invisible at 1,000 units to the
// em; a curve's chords of n equal steps are within max|B''| / 8n² of it).
const FLATNESS = 0.25;
const MAX_CURVE_STEPS = 256;
// The most points one TrueType glyph holds.
export const MAX_GLYPH_POINTS = 65_535;

// A contour as a closed ring of x, y pairs (the last point is the first),
// its curves as lines within FLATNESS font units of them.
export function ringOf(contour: Contour): Float64Array {
  const ring: number[] = [contour.start.x, contour.start.y];
  let previous = contour.start;
  for (const { c1, c2, to } of contour.segments) {
    if (c1 && c2) {
      const bend = 6 * Math.max(
        Math.hypot(previous.x - 2 * c1.x + c2.x, previous.y - 2 * c1.y + c2.y),
        Math.hypot(c1.x - 2 * c2.x + to.x, c1.y - 2 * c2.y + to.y),
      );
      const steps = Math.min(MAX_CURVE_STEPS, Math.max(1, Math.ceil(Math.sqrt(bend / (8 * FLATNESS)))));
      for (let step = 1; step < steps; step += 1) {
        const point = cubicAt(previous, c1, c2, to, step / steps);
        ring.push(point.x, point.y);
      }
    }
    ring.push(to.x, to.y);
    previous = to;
  }
  ring.push(contour.start.x, contour.start.y);
  return Float64Array.from(ring);
}

// A contour of straight lines through `points` (x, y pairs, not closed).
export function polygonContour(points: Float64Array): Contour | null {
  if (points.length < 6) return null;
  const start = { x: points[0]!, y: points[1]! };
  const segments: Segment[] = [];
  for (let index = 2; index + 1 < points.length; index += 2) segments.push({ to: { x: points[index]!, y: points[index + 1]! } });
  return finishContour(start, segments);
}

// ---- Whole font units ----

// TrueType stores each point in whole font units. Rounding each point on
// its own can leave two points of an outline on one spot (a zero-length
// segment) and, where two parts of an outline pass within a unit of each
// other (a corner the outline passes through twice, a thin gap), can push
// one across the other. Snap rounding (Hobby, 1999; Guibas and Marimont,
// 1998) doesn't: every unit square round a rounded corner (a hot pixel) that
// any segment passes through becomes a corner of that segment too, so
// segments that didn't cross still don't, at most meeting at a hot pixel's
// centre. Hot pixels are looked up in cells of SNAP_CELL units.
const SNAP_CELL = 16;
const gridKey = (i: number, j: number) => (i + 131_072) * 262_144 + (j + 131_072);

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const turn = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

// Where segment ab passes through the unit square round (i, j), whose
// left and bottom sides are in it and whose right and top sides aren't (so
// each point is in one square): the middle of that stretch, as a fraction of
// the way from a to b, or -1. A stretch with no length is in it only where
// it touches the left or bottom side.
function throughPixel(a: Point, b: Point, i: number, j: number): number {
  let from = 0;
  let to = 1;
  for (const [start, delta, centre] of [
    [a.x, b.x - a.x, i],
    [a.y, b.y - a.y, j],
  ] as const) {
    if (delta === 0) {
      // Along a side: in the square only along its left or bottom side.
      if (start < centre - 0.5 || start >= centre + 0.5) return -1;
      continue;
    }
    const enter = (centre - 0.5 - start) / delta;
    const leave = (centre + 0.5 - start) / delta;
    from = Math.max(from, Math.min(enter, leave));
    to = Math.min(to, Math.max(enter, leave));
    if (from > to) return -1;
  }
  if (from < to) return (from + to) / 2;
  const x = from === 0 ? a.x : from === 1 ? b.x : a.x + from * (b.x - a.x);
  const y = from === 0 ? a.y : from === 1 ? b.y : a.y + from * (b.y - a.y);
  return x < i + 0.5 && y < j + 0.5 ? from : -1;
}

// `points` (a closed outline in whole units) without a point that repeats
// the one before it or lies on the line between its neighbours (the
// outline going straight on, or back along itself): so no segment has no
// length and none doubles back. Null when fewer than three points are left:
// the outline encloses nothing.
export function cleanOutline(points: Point[]): Point[] | null {
  const kept: Point[] = [];
  for (const point of points) {
    if (kept.length && samePoint(kept.at(-1)!, point)) continue;
    while (kept.length >= 2 && turn(kept.at(-2)!, kept.at(-1)!, point) === 0) kept.pop();
    if (!kept.length || !samePoint(kept.at(-1)!, point)) kept.push(point);
  }
  // Where the outline closes, from its last point back to its first.
  while (kept.length >= 3) {
    if (samePoint(kept.at(-1)!, kept[0]!) || turn(kept.at(-2)!, kept.at(-1)!, kept[0]!) === 0) kept.pop();
    else if (turn(kept.at(-1)!, kept[0]!, kept[1]!) === 0) kept.shift();
    else break;
  }
  return kept.length >= 3 ? kept : null;
}

// One shape's outlines (closed polygons, in font units), which cross
// neither each other nor themselves (they may touch), in whole font units
// by snap rounding, each cleaned (cleanOutline): none of them then crosses
// another or itself either. Throws budget's error when it runs out of
// `work` (cells and hot pixels looked at).
export function snapRound(outlines: Point[][], work: Budget): Point[][] {
  const cells = new Map<number, number[]>();
  const hot = new Set<number>();
  for (const outline of outlines) {
    spend(work, outline.length);
    for (const { x, y } of outline) {
      const i = Math.round(x);
      const j = Math.round(y);
      const pixel = gridKey(i, j);
      if (hot.has(pixel)) continue;
      hot.add(pixel);
      const cell = gridKey(Math.floor(i / SNAP_CELL), Math.floor(j / SNAP_CELL));
      const list = cells.get(cell);
      if (list) list.push(i, j);
      else cells.set(cell, [i, j]);
    }
  }
  // The hot pixels segment ab passes through, from a to b: the cells within
  // half a unit of it, column by column along its longer side.
  const along = (a: Point, b: Point): Point[] => {
    const alongX = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const [u0, v0, du, dv] = alongX ? [a.x, a.y, b.x - a.x, b.y - a.y] : [a.y, a.x, b.y - a.y, b.x - a.x];
    const vAt = (u: number) => (du === 0 ? v0 : v0 + dv * Math.min(1, Math.max(0, (u - u0) / du)));
    const uLow = Math.min(u0, u0 + du) - 0.5;
    const uHigh = Math.max(u0, u0 + du) + 0.5;
    // The squares a and b are in, first and last, and any between.
    const first = { t: 0, x: Math.round(a.x), y: Math.round(a.y) };
    const last = { t: 1, x: Math.round(b.x), y: Math.round(b.y) };
    const hits: { t: number; x: number; y: number }[] = [];
    for (let column = Math.floor(uLow / SNAP_CELL); column <= Math.floor(uHigh / SNAP_CELL); column += 1) {
      const from = Math.max(uLow, column * SNAP_CELL) - 0.5;
      const to = Math.min(uHigh, (column + 1) * SNAP_CELL) + 0.5;
      const vLow = Math.min(vAt(from), vAt(to)) - 0.5;
      const vHigh = Math.max(vAt(from), vAt(to)) + 0.5;
      for (let row = Math.floor(vLow / SNAP_CELL); row <= Math.floor(vHigh / SNAP_CELL); row += 1) {
        spend(work, 1);
        const list = cells.get(alongX ? gridKey(column, row) : gridKey(row, column));
        if (!list) continue;
        spend(work, list.length / 2);
        for (let at = 0; at < list.length; at += 2) {
          const x = list[at]!;
          const y = list[at + 1]!;
          if ((x === first.x && y === first.y) || (x === last.x && y === last.y)) continue;
          const t = throughPixel(a, b, x, y);
          if (t >= 0) hits.push({ t, x, y });
        }
      }
    }
    return [first, ...hits.sort((p, q) => p.t - q.t), last];
  };
  const result: Point[][] = [];
  for (const outline of outlines) {
    const snapped: Point[] = [];
    outline.forEach((a, index) => {
      for (const { x, y } of along(a, outline[(index + 1) % outline.length]!)) {
        if (!snapped.length || snapped.at(-1)!.x !== x || snapped.at(-1)!.y !== y) snapped.push({ x, y });
      }
    });
    const cleaned = cleanOutline(snapped);
    if (cleaned) result.push(cleaned);
  }
  return result;
}

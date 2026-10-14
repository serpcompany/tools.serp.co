// The step of SVG to TTF (svg-font.ts, issue #251) that finds the region a
// shape fills when its outlines cross or touch, by its own fill rule, as
// outlines that wind once round it and never less than nothing: so no shape
// cuts into another where they overlap, and an even-odd star keeps its
// hollow middle. It runs in a worker (svg-font.worker.ts) that svg-font.ts
// stops after REGIONS_TIMEOUT_MS, and every loop in it is bounded by the
// work allowed (REGIONS_BUDGET) and the crossings found (MAX_CROSSINGS).
//
// The shape's outlines, its curves already lines (ringOf), are cut into
// horizontal slabs at every corner's height and every crossing's, so that
// within a slab no two edges cross and their order from left to right is
// fixed. Counting the edges' directions from the left gives the winding
// number between each pair, and the fill rule says which stretches are
// filled: each is a trapezoid of the region. The trapezoids' sides, and
// what is left of their tops and bottoms once the slabs above and below
// cancel them, are the region's outline, joined into loops.

import { MAX_CROSSINGS, MAX_GLYPH_POINTS, finishContour, spend, type Budget, type Contour, type FillRule } from "./svg-font-regions.ts";

export type RegionShape = { fillRule: FillRule; rings: Float64Array[] };
export type RegionsJob = { shapes: RegionShape[] };
// A shape's contours as x, y pairs (straight lines, not closed), or
// `fallback` when its region wasn't found (its outlines cross more than
// MAX_CROSSINGS times, the region needs more points than a glyph holds, or
// the work allowed ran out): svg-font.ts then takes it as drawn.
export type ResolvedShape = { contours: Float64Array[] } | { fallback: true };
export type RegionsReply = { ok: true; shapes: ResolvedShape[] } | { ok: false; error: string };

// Work allowed for one job: edges compared or placed in a slab.
export const REGIONS_BUDGET = 100_000_000;

class OutOfWork extends Error {}

// An edge of the outlines, from its lower end (x1, y1) to its upper end
// (x2, y2), y up; `dir` +1 when the outline runs up it, -1 when down.
type Edge = { x1: number; y1: number; x2: number; y2: number; dir: number; id: number };

function edgesOf(rings: Float64Array[]): Edge[] {
  const edges: Edge[] = [];
  for (const ring of rings) {
    for (let at = 0; at + 3 < ring.length; at += 2) {
      const [ax, ay, bx, by] = [ring[at]!, ring[at + 1]!, ring[at + 2]!, ring[at + 3]!];
      // A level edge bounds no slab: the slabs on either side of it say
      // what it does.
      if (ay === by) continue;
      edges.push(ay < by ? { x1: ax, y1: ay, x2: bx, y2: by, dir: 1, id: edges.length } : { x1: bx, y1: by, x2: ax, y2: ay, dir: -1, id: edges.length });
    }
  }
  return edges;
}

// Where `edge` is at height `y`: exactly its end at either end's height, so
// that two edges meeting at a corner agree on it.
function xAt(edge: Edge, y: number): number {
  if (y === edge.y1) return edge.x1;
  if (y === edge.y2) return edge.x2;
  return edge.x1 + ((edge.x2 - edge.x1) * (y - edge.y1)) / (edge.y2 - edge.y1);
}

function side(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

// The heights at which two edges cross (not where one only touches the
// other: a corner's height is a slab's edge already), or null past `cap`.
function crossingHeights(edges: Edge[], cap: number, budget: Budget): number[] | null {
  const heights: number[] = [];
  const order = [...edges].sort((e, f) => e.y1 - f.y1);
  for (let i = 0; i < order.length; i += 1) {
    const e = order[i]!;
    for (let j = i + 1; j < order.length && order[j]!.y1 < e.y2; j += 1) {
      spend(budget, 1);
      const f = order[j]!;
      if (Math.max(f.x1, f.x2) < Math.min(e.x1, e.x2) || Math.min(f.x1, f.x2) > Math.max(e.x1, e.x2)) continue;
      const d1 = side(f.x1, f.y1, f.x2, f.y2, e.x1, e.y1);
      const d2 = side(f.x1, f.y1, f.x2, f.y2, e.x2, e.y2);
      const d3 = side(e.x1, e.y1, e.x2, e.y2, f.x1, f.y1);
      const d4 = side(e.x1, e.y1, e.x2, e.y2, f.x2, f.y2);
      if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) continue;
      const t = d1 / (d1 - d2);
      const y = e.y1 + t * (e.y2 - e.y1);
      // Strictly inside both edges' heights, or it is a corner's already.
      if (y > Math.max(e.y1, f.y1) && y < Math.min(e.y2, f.y2)) heights.push(y);
      if (heights.length > cap) return null;
    }
  }
  return heights;
}

// A directed piece of the region's outline: from (x1, y1) to (x2, y2), on
// edge `edge` (or -1 when level).
type Piece = { x1: number; y1: number; x2: number; y2: number; edge: number };

const key = (x: number, y: number) => `${x},${y}`;

// The region `fillRule` fills inside `rings`, as contours winding once round
// it, outlines clockwise and holes counterclockwise; null when it needs more
// points than a glyph holds or the outlines cross more than MAX_CROSSINGS
// times.
export function resolveShape({ fillRule, rings }: RegionShape, budget: Budget, cap = MAX_CROSSINGS): Contour[] | null {
  const edges = edgesOf(rings);
  const crossings = crossingHeights(edges, cap, budget);
  if (!crossings) return null;
  const heights = [...new Set([...edges.flatMap((edge) => [edge.y1, edge.y2]), ...crossings])].sort((a, b) => a - b);
  spend(budget, heights.length);
  const filled = (winding: number) => (fillRule === "evenodd" ? winding % 2 !== 0 : winding !== 0);

  const pieces: Piece[] = [];
  // The level parts of the trapezoids' tops and bottoms at each height, as
  // x intervals with the direction the outline runs along them (+1 to the
  // right).
  const level = new Map<number, { from: number; to: number }[]>();
  const addLevel = (y: number, from: number, to: number) => {
    if (from === to) return;
    const list = level.get(y);
    if (list) list.push({ from, to });
    else level.set(y, [{ from, to }]);
  };

  const byStart = [...edges].sort((e, f) => e.y1 - f.y1);
  let next = 0;
  let active: Edge[] = [];
  for (let slab = 0; slab + 1 < heights.length; slab += 1) {
    const bottom = heights[slab]!;
    const top = heights[slab + 1]!;
    while (next < byStart.length && byStart[next]!.y1 <= bottom) active.push(byStart[next++]!);
    active = active.filter((edge) => edge.y2 > bottom);
    spend(budget, active.length);
    if (!active.length) continue;
    const middle = (bottom + top) / 2;
    // Edges that run together through the slab count as one, by the sum of
    // their directions (two outlines drawn on top of each other).
    const placed = active
      .map((edge) => ({ edge, low: xAt(edge, bottom), high: xAt(edge, top), mid: xAt(edge, middle) }))
      .sort((a, b) => a.mid - b.mid || a.low - b.low || a.high - b.high);
    let winding = 0;
    let start: (typeof placed)[number] | null = null;
    for (let at = 0; at < placed.length; ) {
      const first = placed[at]!;
      let sum = 0;
      for (; at < placed.length && placed[at]!.low === first.low && placed[at]!.high === first.high; at += 1) sum += placed[at]!.edge.dir;
      const was = filled(winding);
      winding += sum;
      const now = filled(winding);
      if (!was && now) start = first;
      else if (was && !now && start) {
        const left = start;
        const right = first;
        start = null;
        // The trapezoid, counterclockwise: up its right side, down its left.
        pieces.push({ x1: right.low, y1: bottom, x2: right.high, y2: top, edge: right.edge.id });
        pieces.push({ x1: left.high, y1: top, x2: left.low, y2: bottom, edge: left.edge.id });
        addLevel(top, right.high, left.high);
        addLevel(bottom, left.low, right.low);
      }
    }
  }

  // At each height, the tops of the slab below and the bottoms of the slab
  // above cancel where both are filled; what is left is outline.
  for (const [y, intervals] of level) {
    spend(budget, intervals.length);
    const marks: { x: number; change: number }[] = [];
    for (const { from, to } of intervals) {
      const sign = from < to ? 1 : -1;
      marks.push({ x: Math.min(from, to), change: sign }, { x: Math.max(from, to), change: -sign });
    }
    marks.sort((a, b) => a.x - b.x);
    let count = 0;
    for (let at = 0; at < marks.length; ) {
      const x = marks[at]!.x;
      for (; at < marks.length && marks[at]!.x === x; at += 1) count += marks[at]!.change;
      const to = marks[at]?.x;
      if (to === undefined || count === 0) continue;
      for (let copy = 0; copy < Math.abs(count); copy += 1) {
        pieces.push(count > 0 ? { x1: x, y1: y, x2: to, y2: y, edge: -1 } : { x1: to, y1: y, x2: x, y2: y, edge: -1 });
      }
    }
  }

  // Joined into loops: every corner has as many pieces leaving it as
  // arriving (the trapezoids' outlines, less pairs that cancel), so a walk
  // from any piece comes back to where it began. Along one edge, or one
  // level line, the walk goes straight on.
  spend(budget, pieces.length);
  const leaving = new Map<string, number[]>();
  pieces.forEach((piece, index) => {
    const at = key(piece.x1, piece.y1);
    const list = leaving.get(at);
    if (list) list.push(index);
    else leaving.set(at, [index]);
  });
  const used = new Uint8Array(pieces.length);
  const contours: Contour[] = [];
  let points = 0;
  for (let first = 0; first < pieces.length; first += 1) {
    if (used[first]) continue;
    const loop: Piece[] = [];
    let index = first;
    for (;;) {
      used[index] = 1;
      const piece = pieces[index]!;
      loop.push(piece);
      const choices = leaving.get(key(piece.x2, piece.y2)) ?? [];
      let pick = -1;
      for (const choice of choices) {
        if (used[choice]) continue;
        if (pick === -1) pick = choice;
        if (pieces[choice]!.edge === piece.edge) {
          pick = choice;
          break;
        }
      }
      if (pick === -1) break;
      index = pick;
    }
    // Corners only: a point between two pieces of one edge, or of one level
    // line, is left out.
    const corners = loop.filter((piece, at) => {
      const before = loop[(at - 1 + loop.length) % loop.length]!;
      return before.edge !== piece.edge || (piece.edge === -1 && Math.sign(before.x2 - before.x1) !== Math.sign(piece.x2 - piece.x1));
    });
    const ends = (corners.length ? corners : loop).map((piece) => ({ x: piece.x1, y: piece.y1 }));
    const contour = finishContour(ends[0]!, ends.slice(1).map((to) => ({ to })));
    if (!contour) continue;
    points += ends.length;
    if (points > MAX_GLYPH_POINTS) return null;
    contours.push(contour);
  }
  return contours;
}

function flatten(contour: Contour): Float64Array {
  const points = new Float64Array(2 + contour.segments.length * 2);
  points[0] = contour.start.x;
  points[1] = contour.start.y;
  contour.segments.forEach((segment, index) => {
    points[2 + index * 2] = segment.to.x;
    points[3 + index * 2] = segment.to.y;
  });
  return points;
}

export function resolveRegions(job: RegionsJob, { budget = REGIONS_BUDGET, cap = MAX_CROSSINGS } = {}): RegionsReply {
  try {
    const work: Budget = { left: budget, exceeded: () => new OutOfWork() };
    const shapes = job.shapes.map((shape): ResolvedShape => {
      try {
        const contours = resolveShape(shape, work, cap);
        // Counterclockwise to clockwise: TrueType's outlines run clockwise.
        return contours ? { contours: contours.map((contour) => flatten(contour)).map(reverse) } : { fallback: true };
      } catch (error) {
        if (error instanceof OutOfWork) return { fallback: true };
        throw error;
      }
    });
    return { ok: true, shapes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// x, y pairs in the opposite order.
function reverse(points: Float64Array): Float64Array {
  const result = new Float64Array(points.length);
  for (let at = 0; at < points.length; at += 2) {
    result[points.length - 2 - at] = points[at]!;
    result[points.length - 1 - at] = points[at + 1]!;
  }
  return result;
}

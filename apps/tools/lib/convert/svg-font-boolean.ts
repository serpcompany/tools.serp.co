// The step of SVG to TTF (svg-font.ts, issue #251) that finds the region a
// shape fills when its outlines cross or touch, by its own fill rule, as
// outlines that wind once round it and never less than nothing: so no shape
// cuts into another where they overlap, and an even-odd star keeps its
// hollow middle. It runs in a worker (svg-font.worker.ts) that svg-font.ts
// stops after REGIONS_TIMEOUT_MS. Each shape is worked out on its own, with
// its own allowance of work (REGIONS_WORK) and memory (REGIONS_MEMORY), so
// one intricate shape never decides another's outcome.
//
// The shape's outlines, its curves already lines (ringOf), are cut into
// horizontal slabs at every corner's height and every crossing's, so that
// within a slab no two edges cross and their order from left to right is
// fixed. Counting the edges' directions from the left gives the winding
// number between each pair, and the fill rule says which stretches are
// filled: each is a trapezoid of the region. The trapezoids' sides, and
// what is left of their tops and bottoms once the slabs above and below
// cancel them, are the region's outline, joined into loops. A side that
// carries on along the same edge into the next slab is one piece, so the
// pieces kept grow with the outline found, not with slabs times edges; it
// ends where it meets another outline, so that the loops can turn there
// and never cross.

import { MAX_CROSSINGS, MAX_GLYPH_POINTS, finishContour, spend, type Budget, type FillRule } from "./svg-font-regions.ts";

export type RegionShape = { fillRule: FillRule; rings: Float64Array[] };
export type RegionsJob = { shapes: RegionShape[] };
// Why a shape's region wasn't found: its outlines cross more than
// MAX_CROSSINGS times, the region needs more points than a glyph holds, or
// the work or memory allowed ran out. svg-font.ts then takes it as drawn.
export type RegionsFallback = "crossings" | "points" | "work" | "memory";
// A shape's contours as x, y pairs (straight lines, not closed), clockwise
// outlines and counterclockwise holes, or why there are none.
export type ResolvedShape = { contours: Float64Array[] } | { fallback: RegionsFallback };
// What the worker posts: each shape's region as soon as it is found, then
// `done`, so a shape found before the time limit is kept when a later one
// runs past it.
export type RegionsMessage = { index: number; shape: ResolvedShape } | { done: true };

// Work allowed for one shape, in edges compared, placed in a slab or
// sorted, and pieces joined: about a second in a desktop browser (11 ns
// each in Node on an Apple M-series laptop), a few on a phone, inside
// REGIONS_TIMEOUT_MS.
export const REGIONS_WORK = 100_000_000;

// Memory allowed for one shape's working data, in bytes as V8 stores the
// arrays and objects below (each charged as it is made, before it is
// filled): 64 MB. A browser gives a page's JavaScript a heap of about a
// quarter of the device's memory (V8's default), so 512 MB on a phone with
// 2 GB; the job keeps to an eighth of that, with its input (at most
// MAX_GLYPH_POINTS points, 1 MB) and its output (one glyph's points) on top.
export const REGIONS_MEMORY = 64 * 1024 * 1024;

// Bytes charged per item. An edge: its ends and direction (33), where it is
// in a slab and at the heights either side (40), its place in the order by
// height and its last pieces (12), its slots in the lists of a slab's and a
// height's edges and the sorts' scratch (48), and its share of a height's
// level marks (26). A height: 8, and 8 more for the crossing heights' list.
// A piece: its ends and edge (36), charged again each time its arrays grow,
// and 24 to join it into a loop (its place, the sort's scratch, and its
// mark). A point of the result: its objects while the contour is checked
// (finishContour) and its two copies as numbers.
const EDGE_BYTES = 160;
const HEIGHT_BYTES = 16;
const PIECE_BYTES = 36;
const JOIN_BYTES = 24;
const POINT_BYTES = 160;

class OutOf extends Error {
  readonly reason: RegionsFallback;

  constructor(reason: RegionsFallback) {
    super(reason);
    this.reason = reason;
  }
}

// The shape's edges, from each one's lower end (x1, y1) to its upper end
// (x2, y2), y up; `dir` +1 when the outline runs up it, -1 when down.
type Edges = { x1: Float64Array; y1: Float64Array; x2: Float64Array; y2: Float64Array; dir: Int8Array; count: number; extent: number };

function edgesOf(rings: Float64Array[], memory: Budget): Edges {
  let most = 0;
  for (const ring of rings) most += Math.max(0, ring.length / 2 - 1);
  spend(memory, most * EDGE_BYTES);
  const edges: Edges = {
    x1: new Float64Array(most),
    y1: new Float64Array(most),
    x2: new Float64Array(most),
    y2: new Float64Array(most),
    dir: new Int8Array(most),
    count: 0,
    // The largest distance of a corner from the origin, either way.
    extent: 0,
  };
  for (const ring of rings) {
    for (let at = 0; at + 3 < ring.length; at += 2) {
      const ax = ring[at]!;
      const ay = ring[at + 1]!;
      const bx = ring[at + 2]!;
      const by = ring[at + 3]!;
      edges.extent = Math.max(edges.extent, Math.abs(ax), Math.abs(ay));
      // A level edge bounds no slab: the slabs on either side of it say
      // what it does.
      if (ay === by) continue;
      const id = edges.count++;
      const up = ay < by;
      edges.x1[id] = up ? ax : bx;
      edges.y1[id] = up ? ay : by;
      edges.x2[id] = up ? bx : ax;
      edges.y2[id] = up ? by : ay;
      edges.dir[id] = up ? 1 : -1;
    }
  }
  return edges;
}

// Where edge `id` is at height `y`: exactly its end at either end's height,
// so that two edges meeting at a corner agree on it.
function xAt(edges: Edges, id: number, y: number): number {
  const y1 = edges.y1[id]!;
  const y2 = edges.y2[id]!;
  if (y === y1) return edges.x1[id]!;
  if (y === y2) return edges.x2[id]!;
  const x1 = edges.x1[id]!;
  return x1 + ((edges.x2[id]! - x1) * (y - y1)) / (y2 - y1);
}

function side(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

// The heights at which two edges cross (not where one only touches the
// other: a corner's height is a slab's edge already). `byStart`: the edges
// by their lower ends' heights.
function crossingHeights(edges: Edges, byStart: Int32Array, cap: number, work: Budget, memory: Budget): number[] {
  const heights: number[] = [];
  const { x1, y1, x2, y2 } = edges;
  for (let i = 0; i < byStart.length; i += 1) {
    const e = byStart[i]!;
    for (let j = i + 1; j < byStart.length && y1[byStart[j]!]! < y2[e]!; j += 1) {
      spend(work, 1);
      const f = byStart[j]!;
      if (Math.max(x1[f]!, x2[f]!) < Math.min(x1[e]!, x2[e]!) || Math.min(x1[f]!, x2[f]!) > Math.max(x1[e]!, x2[e]!)) continue;
      const d1 = side(x1[f]!, y1[f]!, x2[f]!, y2[f]!, x1[e]!, y1[e]!);
      const d2 = side(x1[f]!, y1[f]!, x2[f]!, y2[f]!, x2[e]!, y2[e]!);
      const d3 = side(x1[e]!, y1[e]!, x2[e]!, y2[e]!, x1[f]!, y1[f]!);
      const d4 = side(x1[e]!, y1[e]!, x2[e]!, y2[e]!, x2[f]!, y2[f]!);
      if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) continue;
      const t = d1 / (d1 - d2);
      const y = y1[e]! + t * (y2[e]! - y1[e]!);
      // Strictly inside both edges' heights, or it is a corner's already.
      if (!(y > Math.max(y1[e]!, y1[f]!) && y < Math.min(y2[e]!, y2[f]!))) continue;
      if (heights.length >= cap) throw new OutOf("crossings");
      spend(memory, HEIGHT_BYTES);
      heights.push(y);
    }
  }
  return heights;
}

// Directed pieces of the region's outline, from (x1, y1) to (x2, y2), each
// on an edge (or -1 when level), in arrays that grow as pieces are added.
class Pieces {
  x1 = new Float64Array(0);
  y1 = new Float64Array(0);
  x2 = new Float64Array(0);
  y2 = new Float64Array(0);
  edge = new Int32Array(0);
  length = 0;
  private readonly memory: Budget;

  constructor(memory: Budget) {
    this.memory = memory;
  }

  add(x1: number, y1: number, x2: number, y2: number, edge: number): number {
    if (this.length === this.edge.length) this.grow();
    const at = this.length++;
    this.x1[at] = x1;
    this.y1[at] = y1;
    this.x2[at] = x2;
    this.y2[at] = y2;
    this.edge[at] = edge;
    return at;
  }

  private grow(): void {
    const room = Math.max(256, this.edge.length * 2);
    spend(this.memory, room * PIECE_BYTES);
    const copy = <T extends Float64Array | Int32Array>(from: T, to: T): T => {
      to.set(from);
      return to;
    };
    this.x1 = copy(this.x1, new Float64Array(room));
    this.y1 = copy(this.y1, new Float64Array(room));
    this.x2 = copy(this.x2, new Float64Array(room));
    this.y2 = copy(this.y2, new Float64Array(room));
    this.edge = copy(this.edge, new Int32Array(room));
  }
}

// At one height, the tops of the slab below (`tops`, x pairs from right to
// left) and the bottoms of the slab above (`bottoms`, x pairs from left to
// right) cancel where both are filled; what is left is outline, along the
// line: rightward where only a bottom is, leftward where only a top is.
// (Two tops can overlap by a rounding error where their edges cross at
// that height: then the overlap counts twice, as the walk needs it.) A
// piece ends at each of `junctions`, where outlines meet on the line.
function levelPieces(y: number, tops: number[], bottoms: number[], junctions: number[], pieces: Pieces, work: Budget): void {
  const count = tops.length + bottoms.length + junctions.length;
  if (count === junctions.length) return;
  spend(work, count * Math.log2(count + 1));
  const xs = new Float64Array(count);
  const changes = new Int8Array(count);
  let at = 0;
  for (let pair = 0; pair < tops.length; pair += 2) {
    xs[at] = tops[pair + 1]!;
    changes[at++] = -1;
    xs[at] = tops[pair]!;
    changes[at++] = 1;
  }
  for (let pair = 0; pair < bottoms.length; pair += 2) {
    xs[at] = bottoms[pair]!;
    changes[at++] = 1;
    xs[at] = bottoms[pair + 1]!;
    changes[at++] = -1;
  }
  for (const x of junctions) {
    xs[at] = x;
    changes[at++] = 0;
  }
  const order = Int32Array.from({ length: count }, (_, index) => index).sort((a, b) => xs[a]! - xs[b]!);
  // Stretches with the same count make one piece (or as many as the count).
  let winding = 0;
  let runFrom = 0;
  let runWinding = 0;
  for (let next = 0; next < count; ) {
    const x = xs[order[next]!]!;
    let junction = false;
    for (; next < count && xs[order[next]!] === x; next += 1) {
      winding += changes[order[next]!]!;
      if (order[next]! >= tops.length + bottoms.length) junction = true;
    }
    if (winding === runWinding && !junction) continue;
    for (let copy = 0; copy < Math.abs(runWinding); copy += 1) {
      if (runWinding > 0) pieces.add(runFrom, y, x, y, -1);
      else pieces.add(x, y, runFrom, y, -1);
    }
    runFrom = x;
    runWinding = winding;
  }
}

// The tops of a slab's stretches (five numbers each, as regionOf keeps
// them) that are still outline, x pairs from right to left.
function topsOf(stretches: number[]): number[] {
  const tops: number[] = [];
  for (let at = 0; at < stretches.length; at += 5) {
    if (stretches[at + 4] && stretches[at + 2] !== stretches[at + 3]) tops.push(stretches[at + 3]!, stretches[at + 2]!);
  }
  return tops;
}

// The first index in `order` (pieces by where they start) of a piece that
// starts at (x, y) or after it.
function firstFrom(order: Int32Array, pieces: Pieces, x: number, y: number): number {
  let low = 0;
  let high = order.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const piece = order[middle]!;
    const px = pieces.x1[piece]!;
    if (px < x || (px === x && pieces.y1[piece]! < y)) low = middle + 1;
    else high = middle;
  }
  return low;
}

// The region `fillRule` fills inside `rings`, as contours winding once round
// it, outlines counterclockwise and holes clockwise (y up), as x, y pairs.
// Throws OutOf when it can't be found within the allowances.
function regionOf({ fillRule, rings }: RegionShape, work: Budget, memory: Budget, cap: number): Float64Array[] {
  const edges = edgesOf(rings, memory);
  const count = edges.count;
  spend(work, count * Math.log2(count + 1));
  const byStart = Int32Array.from({ length: count }, (_, index) => index).sort((e, f) => edges.y1[e]! - edges.y1[f]!);
  const crossings = crossingHeights(edges, byStart, cap, work, memory);
  spend(memory, (2 * count + crossings.length) * HEIGHT_BYTES);
  const all = new Float64Array(2 * count + crossings.length);
  all.set(edges.y1.subarray(0, count));
  all.set(edges.y2.subarray(0, count), count);
  all.set(crossings, 2 * count);
  all.sort();
  let heightCount = 0;
  for (let at = 0; at < all.length; at += 1) {
    if (heightCount === 0 || all[at] !== all[heightCount - 1]) all[heightCount++] = all[at]!;
  }
  const heights = all.subarray(0, heightCount);
  spend(work, heights.length);
  const filled = (winding: number) => (fillRule === "evenodd" ? winding % 2 !== 0 : winding !== 0);

  const pieces = new Pieces(memory);
  const low = new Float64Array(count);
  const high = new Float64Array(count);
  const middle = new Float64Array(count);
  // The piece each edge last ended as a right side (going up) and as a left
  // side (going down): a side that goes on in the next slab extends it.
  const lastUp = new Int32Array(count).fill(-1);
  const lastDown = new Int32Array(count).fill(-1);
  // Where each edge is at the current slab's bottom (`at`) and top (`atTop`):
  // worked out once for each height, for the slab below it and the slab
  // above, with places closer than `near` made one (placeAt). The edges
  // that meet at each place, as lists of x and then the edges there.
  let at = new Float64Array(count);
  let atTop = new Float64Array(count);
  let meetAt: number[][] = [];
  let meetTop: number[][] = [];
  const near = edges.extent * 1e-12;
  // `ids` (edges at height `y`, in any order) placed into `into`, and the
  // places where two or more meet. Where edges cross, each one's place is
  // worked out on its own, and rounding can put them a hair apart: those
  // within `near` (a trillionth of the drawing's reach) of each other are
  // put at one place (the end of an edge there, if one of them ends there),
  // so the outline meets itself at a corner instead of stepping across.
  const placeAt = (ids: number[], y: number, into: Float64Array): number[][] => {
    const meets: number[][] = [];
    if (!ids.length) return meets;
    // Nearly in order already (as the slab below left them), so the sort
    // takes about one look at each.
    spend(work, 2 * ids.length);
    for (const edge of ids) into[edge] = xAt(edges, edge, y);
    ids.sort((e, f) => into[e]! - into[f]!);
    for (let from = 0; from < ids.length; ) {
      let to = from + 1;
      while (to < ids.length && into[ids[to]!]! - into[ids[to - 1]!]! <= near) to += 1;
      if (to - from > 1) {
        let x = into[ids[from]!]!;
        for (let index = from; index < to; index += 1) {
          const edge = ids[index]!;
          if (y === edges.y1[edge] || y === edges.y2[edge]) {
            x = into[edge]!;
            break;
          }
        }
        for (let index = from; index < to; index += 1) into[ids[index]!] = x;
        meets.push([x, ...ids.slice(from, to)]);
      }
      from = to;
    }
    return meets;
  };
  let active: number[] = [];
  let next = 0;
  const startingAt = (y: number) => {
    const starting: number[] = [];
    while (next < count && edges.y1[byStart[next]!]! <= y) starting.push(byStart[next++]!);
    return starting;
  };
  if (heights.length) {
    active = startingAt(heights[0]!);
    meetAt = placeAt([...active], heights[0]!, at);
  }
  // How many edges run together with each one through the slab below and
  // the current one (1 when it runs alone).
  let groupBelow = new Int32Array(count);
  let group = new Int32Array(count);
  // The slab at whose bottom each edge meets others: a side there ends,
  // and doesn't go on as the same piece, so the walk can turn there.
  const meetsSlab = new Int32Array(count).fill(-2);
  // The filled stretches of the slab below, five numbers each: its left and
  // right edges, where they are at its top, and 1 while its top is
  // outline. A stretch between the same two edges in the slab above goes
  // on: its bottom and the top below are the same line, and cancel.
  let below: number[] = [];
  const belowByLeft = new Int32Array(count);
  const belowSlab = new Int32Array(count).fill(-2);
  for (let slab = 0; slab + 1 < heights.length; slab += 1) {
    const bottom = heights[slab]!;
    const top = heights[slab + 1]!;
    const starting = startingAt(top);
    meetTop = placeAt([...active, ...starting], top, atTop);
    const bottoms: number[] = [];
    const stretches: number[] = [];
    if (active.length) {
      // Placed and sorted: in the order of the slab before, but for edges
      // that crossed or began at its top, so the sort finds them nearly in
      // order already.
      spend(work, 3 * active.length);
      const mid = (bottom + top) / 2;
      for (const edge of active) {
        low[edge] = at[edge]!;
        high[edge] = atTop[edge]!;
        middle[edge] = xAt(edges, edge, mid);
      }
      active.sort((e, f) => middle[e]! - middle[f]! || low[e]! - low[f]! || high[e]! - high[f]!);
      // Edges that run together through the slab (two outlines drawn on top
      // of each other) are a group, counted as one by the sum of their
      // directions.
      for (let index = 0; index < active.length; ) {
        const first = active[index]!;
        let end = index + 1;
        while (end < active.length && low[active[end]!] === low[first] && high[active[end]!] === high[first]) end += 1;
        for (let member = index; member < end; member += 1) group[active[member]!] = end - index;
        index = end;
      }
    }
    // Where edges meet at the bottom, unless they are one group running on
    // through it from the slab below.
    const junctions: number[] = [];
    for (const [x, ...members] of meetAt) {
      const runsOn = members.every(
        (edge) => edges.y1[edge]! < bottom && edges.y2[edge]! > bottom && groupBelow[edge] === members.length && group[edge] === members.length,
      );
      if (runsOn) continue;
      junctions.push(x!);
      for (const edge of members) meetsSlab[edge] = slab;
    }
    if (active.length) {
      let winding = 0;
      let start = -1;
      for (let index = 0; index < active.length; ) {
        const first = active[index]!;
        let sum = 0;
        for (const end = index + group[first]!; index < end; index += 1) sum += edges.dir[active[index]!]!;
        const was = filled(winding);
        winding += sum;
        const now = filled(winding);
        if (!was && now) start = first;
        else if (was && !now && start !== -1) {
          const left = start;
          const right = first;
          start = -1;
          // The trapezoid, counterclockwise: up its right side, down its
          // left, along its top leftward and its bottom rightward.
          const up = lastUp[right]!;
          if (up !== -1 && pieces.y2[up] === bottom && meetsSlab[right] !== slab) {
            pieces.x2[up] = high[right]!;
            pieces.y2[up] = top;
          } else {
            lastUp[right] = pieces.add(low[right]!, bottom, high[right]!, top, right);
          }
          const down = lastDown[left]!;
          if (down !== -1 && pieces.y1[down] === bottom && meetsSlab[left] !== slab) {
            pieces.x1[down] = high[left]!;
            pieces.y1[down] = top;
          } else {
            lastDown[left] = pieces.add(high[left]!, top, low[left]!, bottom, left);
          }
          const under = belowSlab[left] === slab - 1 ? belowByLeft[left]! : -1;
          if (under !== -1 && below[5 * under + 1] === right) below[5 * under + 4] = 0;
          else if (low[left]! !== low[right]!) bottoms.push(low[left]!, low[right]!);
          belowByLeft[left] = stretches.length / 5;
          belowSlab[left] = slab;
          stretches.push(left, right, high[left]!, high[right]!, 1);
        }
      }
    }
    levelPieces(bottom, topsOf(below), bottoms, junctions, pieces, work);
    below = stretches;
    active = active.filter((edge) => edges.y2[edge]! > top).concat(starting);
    [at, atTop] = [atTop, at];
    [meetAt, meetTop] = [meetTop, meetAt];
    [groupBelow, group] = [group, groupBelow];
  }
  if (heights.length) levelPieces(heights[heights.length - 1]!, topsOf(below), [], meetAt.map(([x]) => x!), pieces, work);

  // Joined into loops: every corner has as many pieces leaving it as
  // arriving (the trapezoids' outlines, less what cancels, and a side that
  // runs on is one piece instead of two that meet), so a walk from any
  // piece comes back to where it began. Where several pieces leave a corner,
  // the walk turns as sharply left as it can (the first piece clockwise from
  // the one it came along): round the region's corner it came in by, which
  // is on its left. So no loop crosses another or itself; at most they touch.
  const total = pieces.length;
  spend(memory, total * JOIN_BYTES);
  spend(work, total * Math.log2(total + 1));
  const order = Int32Array.from({ length: total }, (_, index) => index).sort(
    (a, b) => pieces.x1[a]! - pieces.x1[b]! || pieces.y1[a]! - pieces.y1[b]!,
  );
  const used = new Uint8Array(total);
  const loop = new Int32Array(total);
  const contours: Float64Array[] = [];
  const direction = (piece: number) => Math.atan2(pieces.y2[piece]! - pieces.y1[piece]!, pieces.x2[piece]! - pieces.x1[piece]!);
  let points = 0;
  for (let first = 0; first < total; first += 1) {
    if (used[first]) continue;
    let length = 0;
    let index = first;
    for (;;) {
      used[index] = 1;
      loop[length++] = index;
      const x = pieces.x2[index]!;
      const y = pieces.y2[index]!;
      // How far clockwise each piece leaving here turns from the way back.
      const back = direction(index) + Math.PI;
      const turn = (piece: number) => {
        let angle = back - direction(piece);
        while (angle <= 0) angle += 2 * Math.PI;
        while (angle > 2 * Math.PI) angle -= 2 * Math.PI;
        return angle;
      };
      // Back where the loop began, it closes unless another piece turns
      // sharper.
      const closing = pieces.x1[first] === x && pieces.y1[first] === y;
      let pick = closing ? first : -1;
      let best = closing ? turn(first) : Infinity;
      for (let at = firstFrom(order, pieces, x, y); at < total; at += 1) {
        const choice = order[at]!;
        if (pieces.x1[choice] !== x || pieces.y1[choice] !== y) break;
        spend(work, 1);
        if (used[choice]) continue;
        const angle = turn(choice);
        if (angle < best) {
          best = angle;
          pick = choice;
        }
      }
      if (pick === -1 || pick === first) break;
      index = pick;
    }
    // Corners only: a point between two pieces of one edge, or of one level
    // line the same way, is left out, unless other pieces meet there too
    // (the loop then passes a corner of another, which it may touch).
    const ends: { x: number; y: number }[] = [];
    const meeting = (x: number, y: number) => {
      const from = firstFrom(order, pieces, x, y);
      const second = order[from + 1];
      return second !== undefined && pieces.x1[second] === x && pieces.y1[second] === y;
    };
    for (let at = 0; at < length; at += 1) {
      const piece = loop[at]!;
      const before = loop[(at - 1 + length) % length]!;
      const edge = pieces.edge[piece]!;
      const x = pieces.x1[piece]!;
      const y = pieces.y1[piece]!;
      const turns =
        pieces.edge[before] !== edge ||
        (edge === -1 && Math.sign(pieces.x2[before]! - pieces.x1[before]!) !== Math.sign(pieces.x2[piece]! - x)) ||
        meeting(x, y);
      if (turns) ends.push({ x, y });
    }
    if (!ends.length) ends.push({ x: pieces.x1[loop[0]!]!, y: pieces.y1[loop[0]!]! });
    spend(memory, ends.length * POINT_BYTES);
    const contour = finishContour(ends[0]!, ends.slice(1).map((to) => ({ to })));
    if (!contour) continue;
    points += ends.length;
    if (points > MAX_GLYPH_POINTS) throw new OutOf("points");
    const flat = new Float64Array(2 * ends.length);
    ends.forEach((point, at) => {
      flat[2 * at] = point.x;
      flat[2 * at + 1] = point.y;
    });
    contours.push(flat);
  }
  return contours;
}

// One shape's region, by its own fill rule, as clockwise outlines and
// counterclockwise holes (as TrueType's run), within its own allowances of
// work and memory, or why it wasn't found.
export function resolveShape(
  shape: RegionShape,
  { work = REGIONS_WORK, memory = REGIONS_MEMORY, cap = MAX_CROSSINGS }: { work?: number; memory?: number; cap?: number } = {},
): ResolvedShape {
  const workLeft: Budget = { left: work, exceeded: () => new OutOf("work") };
  const memoryLeft: Budget = { left: memory, exceeded: () => new OutOf("memory") };
  try {
    return { contours: regionOf(shape, workLeft, memoryLeft, cap).map(reverse) };
  } catch (error) {
    if (error instanceof OutOf) return { fallback: error.reason };
    throw error;
  }
}

// Every shape of a job, each on its own (resolveShape).
export function resolveRegions(job: RegionsJob, allowances?: Parameters<typeof resolveShape>[1]): ResolvedShape[] {
  return job.shapes.map((shape) => resolveShape(shape, allowances));
}

// x, y pairs in the opposite order: counterclockwise to clockwise.
function reverse(points: Float64Array): Float64Array {
  const result = new Float64Array(points.length);
  for (let at = 0; at < points.length; at += 2) {
    result[points.length - 2 - at] = points[at]!;
    result[points.length - 1 - at] = points[at + 1]!;
  }
  return result;
}

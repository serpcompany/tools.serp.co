// SVG to TTF's TrueType points (svg-font.ts, issue #251): a glyph's curves
// made into TrueType's points as svg2ttf 6.1.0 makes them, counted exactly,
// and svg2ttf writing the font from those points.
//
// svg2ttf makes a cubic curve into quadratic ones (cubicToQuad), then drops
// points from the glyph's contours (lib/ttf.js): `simplify`, twice, drops a
// point that lies on the line through its neighbours; `interpolate` drops an
// on-curve point midway between two off-curve ones, which TrueType implies;
// `roundPoints` rounds to whole units. A smooth curve then keeps about one
// point for each quadratic, not two. Its quadratics can be many times the
// points it keeps (a curve that runs back along a line makes 16 and keeps
// 2), and svg2ttf holds them all at once, so the points are made here
// instead, a contour at a time from its end, keeping only those left at the
// end, and svg2ttf is handed them as they are (writeTtf).

import svg2ttf from "svg2ttf";
import svg2ttfMath from "svg2ttf/lib/math.js";
import svg2ttfSvg from "svg2ttf/lib/svg.js";
import svg2ttfSteps from "svg2ttf/lib/ttf/utils.js";

import type { Point, Segment } from "./svg-font-regions.ts";

export type TtfPoint = { x: number; y: number; onCurve: boolean };

// The accuracy, in font units, to which svg2ttf turns a cubic curve into
// quadratic ones for a glyph 500 units or more wide or tall, as every glyph
// here is (its height is the em's 1,000 units).
const SVG2TTF_ACCURACY = 0.3;
// The accuracies svg2ttf's generateTTF gives `simplify` and `interpolate`.
const SIMPLIFY_ACCURACY = 0.3;
const INTERPOLATE_ACCURACY = 1.1;

// svg2ttf's own, as they are before writeTtf swaps any.
const { cubicToQuad, toSfntCoutours } = svg2ttfSvg;
const { simplify, interpolate } = svg2ttfSteps;
const { Point: MathPoint, isInLine } = svg2ttfMath;

// A curve's points are taken to a hundredth of a unit, as svg-font.ts wrote
// them in the path data it gave svg2ttf before (and -0 as 0, as svg2ttf read
// that back).
const hundredth = (value: number) => Math.round(value * 100) / 100 + 0;

// A contour's TrueType points pass through stages, each handed the points
// last first, as `simplify` works through them.
type Stage = { push: (point: TtfPoint) => void; end: () => void };

// The points svg2ttf makes of a contour written as path data (svg.js
// toSfntCoutours, after cubicToQuad): its start, then each line's end, and
// each quadratic's control point (off the curve) and end. Handed to `stage`
// last first, a segment at a time, so a contour's quadratics are never held
// together.
function makePoints(start: Point, segments: Segment[], stage: Stage): void {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const { c1, c2, to } = segments[index]!;
    if (c1 && c2) {
      const from = index ? segments[index - 1]!.to : start;
      const curve = ["C", hundredth(c1.x), hundredth(c1.y), hundredth(c2.x), hundredth(c2.y), hundredth(to.x), hundredth(to.y)] as const;
      const quads = cubicToQuad([...curve], 0, hundredth(from.x), hundredth(from.y), SVG2TTF_ACCURACY) ?? [];
      for (let at = quads.length - 1; at >= 0; at -= 1) {
        const quad = quads[at]!;
        stage.push({ x: quad[3] as number, y: quad[4] as number, onCurve: true });
        stage.push({ x: quad[1] as number, y: quad[2] as number, onCurve: false });
      }
    } else {
      stage.push({ x: hundredth(to.x), y: hundredth(to.y), onCurve: true });
    }
  }
  stage.push({ x: hundredth(start.x), y: hundredth(start.y), onCurve: true });
  stage.end();
}

// One pass of svg2ttf's `simplify` (lib/ttf/utils.js), handed the points
// last first: from the second to last back to the third, a point is dropped
// when the point before it and the point kept after it are on the curve and
// it lies on the line between them (svg2ttf's own isInLine). svg2ttf takes
// each point out of an array of them all; this holds only the two before
// the point it decides. Passes on what it keeps, last first.
function simplifyPass(next: Stage): Stage {
  let after: TtfPoint | null = null;
  let current: TtfPoint | null = null;
  let before: TtfPoint | null = null;
  return {
    push(point) {
      if (!after) {
        after = point;
        next.push(point);
      } else if (!current) {
        current = point;
      } else if (!before) {
        before = point;
      } else {
        // `point` is before `before`, so `current` isn't one of the first two.
        const inLine =
          before.onCurve &&
          after.onCurve &&
          isInLine(new MathPoint(before.x, before.y), new MathPoint(current.x, current.y), new MathPoint(after.x, after.y), SIMPLIFY_ACCURACY);
        if (!inLine) {
          after = current;
          next.push(current);
        }
        current = before;
        before = point;
      }
    },
    end() {
      if (current) next.push(current);
      if (before) next.push(before);
      next.end();
    },
  };
}

// svg2ttf's `interpolate`, handed the points last first: an on-curve point
// between two off-curve ones (as they were before this step), within
// INTERPOLATE_ACCURACY of their midpoint, is dropped; the first and last
// points are kept.
function interpolatePass(next: Stage): Stage {
  let after: TtfPoint | null = null;
  let current: TtfPoint | null = null;
  return {
    push(point) {
      if (!after) {
        after = point;
        next.push(point);
        return;
      }
      if (current) {
        const implied =
          !point.onCurve &&
          current.onCurve &&
          !after.onCurve &&
          new MathPoint(point.x, point.y).add(new MathPoint(after.x, after.y)).div(2).sub(new MathPoint(current.x, current.y)).dist() <
            INTERPOLATE_ACCURACY;
        if (!implied) next.push(current);
        after = current;
      }
      current = point;
    },
    end() {
      if (current) next.push(current);
      next.end();
    },
  };
}

class TooManyPoints extends Error {}

// svg2ttf's `roundPoints`, then, as svg-font.ts has had svg2ttf do since
// round 3 of its review, a point on the same spot as the one before it
// merged into it, on the curve if either is: rounding leaves such points
// where a curve is under a unit long, and the outline is the same without
// them. Collects the points, last first; throws TooManyPoints once they are
// more than `room` and one more (the last of them may merge into the first).
function collect(room: number): Stage & { points: TtfPoint[] } {
  const points: TtfPoint[] = [];
  return {
    points,
    push({ x, y, onCurve }) {
      const point = { x: Math.round(x), y: Math.round(y), onCurve };
      const last = points.at(-1);
      if (last && last.x === point.x && last.y === point.y) {
        last.onCurve ||= point.onCurve;
        return;
      }
      if (points.length > room) throw new TooManyPoints();
      points.push(point);
    },
    end() {},
  };
}

const whole = (point: TtfPoint) => point.onCurve && Number.isInteger(point.x) && Number.isInteger(point.y);
class NotWhole extends Error {}

// Whether every point that one pass of `simplify` keeps of a contour is on
// the curve and in whole units, so that the second pass is skipped: since
// round 3 of its review, svg-font.ts had svg2ttf skip `simplify` for a
// contour all of whose points are (so as not to move one pass of a snapped
// outline across another), and the points made here are the same. The
// contour's first two points are always kept, so one that starts with a
// curve isn't; otherwise the pass is run to the first point that isn't.
function simplifiedIsWhole(start: Point, segments: Segment[]): boolean {
  const first = segments[0];
  if (!first || first.c1 || !whole({ x: hundredth(start.x), y: hundredth(start.y), onCurve: true })) return false;
  if (!whole({ x: hundredth(first.to.x), y: hundredth(first.to.y), onCurve: true })) return false;
  const check: Stage = {
    push(point) {
      if (!whole(point)) throw new NotWhole();
    },
    end() {},
  };
  try {
    makePoints(start, segments, simplifyPass(check));
  } catch (error) {
    if (error instanceof NotWhole) return false;
    throw error;
  }
  return true;
}

// The TrueType points of a closed contour of lines and cubic curves (in font
// units, at least one of them a curve), as svg2ttf 6.1.0 makes them when
// its path data is written to a hundredth of a unit: cubicToQuad, `simplify`
// twice (skipped once what it keeps is all on the curve in whole units),
// `interpolate`, `roundPoints`, and repeated points merged (collect). Null
// when they are more than `room`, found out as soon as they are: no more
// than `room` points are kept, and only a segment's quadratics at a time.
export function curvePoints({ start, segments }: { start: Point; segments: Segment[] }, room: number): TtfPoint[] | null {
  const collected = collect(room);
  const steps = interpolatePass(collected);
  try {
    makePoints(start, segments, simplifyPass(simplifiedIsWhole(start, segments) ? steps : simplifyPass(steps)));
  } catch (error) {
    if (error instanceof TooManyPoints) return null;
    throw error;
  }
  const points = collected.points.reverse();
  // The last point, on the same spot as the first, merges into it (and
  // svg2ttf's removeClosingReturnPoints then has nothing to drop).
  const first = points[0]!;
  const last = points.at(-1)!;
  if (points.length > 1 && first.x === last.x && first.y === last.y) {
    points.pop();
    first.onCurve ||= last.onCurve;
  }
  return points.length > room ? null : points;
}

// svg2ttf writing `svgFont`, whose one glyph's TrueType points are
// `contours` (curvePoints, and outlines of straight lines in whole units):
// svg2ttf is handed them as they are, so its own steps on them are swapped
// for ones that leave them be (lib/svg.js and lib/ttf/utils.js, whose
// functions svg2ttf 6.1.0 looks up on those modules each time it runs). The
// glyph's path data in `svgFont` only marks it as the one that has them.
// Throws when svg2ttf didn't take them (a bundler that copied a module).
export function writeTtf(svgFont: string, contours: TtfPoint[][], options: Parameters<typeof svg2ttf>[1]): ReturnType<typeof svg2ttf> {
  let handed = 0;
  svg2ttfSvg.cubicToQuad = () => undefined;
  svg2ttfSvg.toSfntCoutours = (path) => {
    if (!path.segments.length) return toSfntCoutours(path);
    handed += 1;
    return contours;
  };
  svg2ttfSteps.simplify = (glyphContours) => glyphContours;
  svg2ttfSteps.interpolate = (glyphContours) => glyphContours;
  try {
    const ttf = svg2ttf(svgFont, options);
    if (handed !== 1) throw new Error(`svg2ttf took the glyph's points ${handed} times`);
    return ttf;
  } finally {
    Object.assign(svg2ttfSvg, { cubicToQuad, toSfntCoutours });
    Object.assign(svg2ttfSteps, { simplify, interpolate });
  }
}

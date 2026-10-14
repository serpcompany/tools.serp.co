// svg2ttf 6.1.0 ships no types: the parts lib/convert/svg-font.ts uses.
declare module "svg2ttf" {
  type Svg2ttfOptions = {
    copyright?: string;
    description?: string;
    familyname?: string;
    fullname?: string;
    id?: string;
    subfamilyname?: string;
    ts?: number;
    url?: string;
    version?: string;
  };
  // `buffer` is a Uint8Array where the runtime has one, as every browser does.
  export default function svg2ttf(svgFont: string, options?: Svg2ttfOptions): { buffer: Uint8Array };
}

// svg2ttf's steps on a glyph's TrueType points, which lib/ttf.js looks up on
// this module's exports each time it runs: svg-font.ts swaps two of them.
declare module "svg2ttf/lib/ttf/utils.js" {
  type TtfPoint = { x: number; y: number; onCurve: boolean };
  const steps: {
    simplify: (contours: TtfPoint[][], accuracy: number) => TtfPoint[][];
    roundPoints: (contours: TtfPoint[][]) => TtfPoint[][];
  };
  export default steps;
}

// svg2ttf's step that turns a cubic curve (a "C" segment from x, y) into
// quadratic ones ("Q" segments), to the accuracy given: svg-font.ts counts
// the points they will take before svg2ttf runs.
declare module "svg2ttf/lib/svg.js" {
  type Segment = [string, ...number[]];
  const svg: {
    cubicToQuad: (segment: Segment, index: number, x: number, y: number, accuracy: number) => Segment[] | undefined;
  };
  export default svg;
}

// svg2ttf's geometry helpers: svg-font.ts's one-pass `simplify` uses its
// test for a point on the line between two others, to give the same result.
declare module "svg2ttf/lib/math.js" {
  class Point {
    constructor(x: number, y: number);
    x: number;
    y: number;
  }
  const math: {
    Point: typeof Point;
    isInLine: (p1: Point, m: Point, p2: Point, accuracy: number) => boolean;
  };
  export default math;
}

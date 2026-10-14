// svg2ttf 6.1.0 ships no types: the parts lib/convert/svg-font.ts and
// svg-font-ttf.ts use.
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
// this module's exports each time it runs: svg-font-ttf.ts makes the points
// as these do, and swaps two for steps that leave its points be.
declare module "svg2ttf/lib/ttf/utils.js" {
  type TtfPoint = { x: number; y: number; onCurve: boolean };
  const steps: {
    simplify: (contours: TtfPoint[][], accuracy: number) => TtfPoint[][];
    interpolate: (contours: TtfPoint[][], accuracy: number) => TtfPoint[][];
  };
  export default steps;
}

// svg2ttf's steps that turn a cubic curve (a "C" segment from x, y) into
// quadratic ones ("Q" segments), to the accuracy given, and a glyph's path
// (an svgpath object) into TrueType points, which index.js looks up on this
// module's exports each time it runs: svg-font-ttf.ts makes the points with
// the first, and swaps both so svg2ttf takes its points as they are.
declare module "svg2ttf/lib/svg.js" {
  type Segment = [string, ...number[]];
  type TtfPoint = { x: number; y: number; onCurve: boolean };
  const svg: {
    cubicToQuad: (segment: Segment, index: number, x: number, y: number, accuracy: number) => Segment[] | undefined;
    toSfntCoutours: (path: { segments: Segment[] }) => TtfPoint[][];
  };
  export default svg;
}

// svg2ttf's geometry helpers: svg-font-ttf.ts tests and measures points with
// them as svg2ttf's `simplify` and `interpolate` do, to give the same result.
declare module "svg2ttf/lib/math.js" {
  class Point {
    constructor(x: number, y: number);
    x: number;
    y: number;
    add(point: Point): Point;
    sub(point: Point): Point;
    div(value: number): Point;
    dist(): number;
  }
  const math: {
    Point: typeof Point;
    isInLine: (p1: Point, m: Point, p2: Point, accuracy: number) => boolean;
  };
  export default math;
}

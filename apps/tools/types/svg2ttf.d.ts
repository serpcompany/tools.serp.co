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

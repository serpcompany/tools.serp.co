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

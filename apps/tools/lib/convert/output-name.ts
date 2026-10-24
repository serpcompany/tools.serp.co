// The names converted files are saved under. A file takes its Tool's target
// id as its extension, except where that id names a format no player knows as
// an extension, or a codec rather than the file we write (owner decisions,
// #373): MPEG-2 is saved as .mpg, AVCHD as .m2ts, ALAC as .m4a (written with
// -f ipod) and Motion JPEG as .avi (written with -f avi). The download
// (components/HeroConverter.tsx), FFmpeg's output file
// (lib/convert/ffmpeg-args.ts and app/api/video-convert/route.ts), the
// converter pages' file filter (converterAccept in lib/tool-sections.ts) and
// the content briefs (scripts/lib/engine-facts.mjs) all read the extension here.
export const OUTPUT_EXTENSIONS: Readonly<Record<string, string>> = {
  mpeg2: "mpg",
  avchd: "m2ts",
  alac: "m4a",
  mjpeg: "avi",
};

export function outputExtension(to: string): string {
  return OUTPUT_EXTENSIONS[to.toLowerCase()] ?? to;
}

// "<name><suffix>.<extension>", from the uploaded file's name without its
// last extension.
export function outputFileName(fileName: string, to: string, suffix = ""): string {
  return `${fileName.replace(/\.[^.]+$/, "")}${suffix}.${outputExtension(to)}`;
}

// The name output `index` of several is saved under: "<name>_page1",
// "<name>_page2"... in order, unless `names` gives each its own label (a
// slide's number, "slide3"; a sheet's name), already safe in a file name.
export function multipleOutputName(fileName: string, to: string, index: number, names?: string[]): string {
  return outputFileName(fileName, to, `_${names?.[index] ?? `page${index + 1}`}`);
}

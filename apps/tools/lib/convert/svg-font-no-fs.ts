// node:fs for svgicons2svgfont in the browser build (next.config.mjs points
// its imports here, and only its): SVG to TTF (svg-font.ts) never reads a
// folder of icons or renames a file, so these only say why they can't.
function noFileSystem(): never {
  throw new Error("svgicons2svgfont: there is no file system in the browser.");
}

export const createReadStream = noFileSystem;
export const readdir = noFileSystem;
export const rename = noFileSystem;

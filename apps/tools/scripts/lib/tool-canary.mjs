// The canary sweep (issue #246): one Tool for each engine and each kind of
// page the Tool sweep runs, checked on every PR by scripts/tool-canary.mjs, so
// a change that breaks an engine fails CI instead of reaching visitors. Each
// entry says what it guards. lib/tool-canary.test.mjs checks that every canary
// passes in benchmarks/tool-sweep-results.json, and that every engine and page
// the sweep can run has a canary or is in UNGUARDED.
//
// HEVC output is left out: Playwright's Chromium on Linux has no HEVC encoder.

export const CANARY_TOOLS = {
  "mov-to-mp4": "FFmpeg.wasm video to MP4 (H.264), the most-used output",
  "mp4-to-webm": "FFmpeg.wasm video to WebM",
  "mp4-to-gif": "FFmpeg.wasm video to GIF, with its own size and frame-rate filter",
  "mp4-to-mp3": "FFmpeg.wasm audio track out of a video",
  "wav-to-mp3": "FFmpeg.wasm audio to audio",
  "compress-mp4": "FFmpeg.wasm video compression",
  "compress-mp3": "FFmpeg.wasm audio compression",
  "mp4-to-3gp": "FFmpeg.wasm 3GP output: H.263's fixed frame sizes",
  "mp4-to-mxf": "FFmpeg.wasm MXF output: a fixed frame rate and 48 kHz audio",
  "mp4-to-rm": "RealMedia output: /api/video-convert first, then FFmpeg.wasm",
  "mp4-to-av1": "AV1 encoding with WebCodecs (Mediabunny)",
  "av1-to-mp4": "AV1 decoding with WebCodecs (Mediabunny)",
  "jpg-to-pdf": "canvas image conversion, to PDF",
  "image-to-pdf": "Image to PDF: a browser-decoded image written losslessly into a PDF with pdf-lib",
  "cr2-to-jpg": "ImageMagick WASM, camera RAW input",
  "compress-gif": "ImageMagick WASM image compression",
  "compress-jpg": "jSquash image compression in a worker",
  "batch-compress-png": "batch compression page: several PNGs saved as one ZIP",
  "heic-to-jpg": "HEIC decoder",
  "pdf-to-jpg": "pdf.js rendering",
  "png-to-txt": "Tesseract OCR with its self-hosted assets",
  "jpg-to-docx": "image to Word document",
  "png-to-epub": "image to EPUB",
  "pdf-to-epub": "a PDF's text read with pdf.js into a reflowable EPUB 3, opened and its XHTML parsed; a scan, a password and a damaged PDF refused",
  "compress-svg": "SVGO",
  "csv-to-json": "table converter page",
  "excel-to-csv": "table converter page with an XLSX upload, read by the XLSX reader in a worker, its cells as Excel shows them",
  "csv-to-pdf": "table converter page writing a file: jsPDF and jspdf-autotable, loaded when the output is chosen",
  "csv-to-jpg": "CSV drawn as a table on a canvas, on the generic converter page (table-outputs.ts)",
  "docx-to-jpeg": "DOCX pages laid out by docx-preview in a sandboxed iframe and captured by modern-screenshot, an image a page",
  "docx-to-svg": "DOCX pages the converter continues itself: text and a table run past a page's end, the table keeping its merged column and header row",
  "dxf-to-png": "DXF drawn by dxf-viewer with three.js and WebGL, its text in the self-hosted DejaVu Sans",
  "html-to-webp": "an HTML page laid out in a sandboxed iframe that loads nothing, captured by modern-screenshot",
  "txt-to-png": "plain text drawn on a canvas in the self-hosted DejaVu Sans, long lines wrapped",
  "dot-to-png": "a Graphviz DOT graph laid out by Viz.js (Graphviz in WebAssembly) in a worker, drawn through an <img>",
  "xlsx-to-png": "an XLSX sheet read with fflate, its numbers in their formats, drawn as the table converters draw a table",
  "pptx-to-png": "a PowerPoint slide drawn as SVG by pptx-glimpse in a worker, then through an <img>",
  "bin-to-png": "a TIFF saved as .bin, found by its first bytes and read by ImageMagick WASM; a .bin that isn't a picture refused",
  "svg-to-ttf": "an SVG icon's filled shapes as one TrueType glyph on U+E000 (svgicons2svgfont, svg2ttf), opened with opentype.js",
  "json-to-csv": "JSON to CSV page",
  "csv-combiner": "CSV combiner page: two files in, one out",
  "html-to-markdown": "HTML to Markdown page",
};

// The canaries that didn't pass in a sweep's rows, with what the row says. A
// canary with no row failed too: the sweep never measured it.
export function failingCanaries(rows, ids) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (row?.status === "pass") return [];
    if (!row) return [{ id, status: "missing", error: "the sweep has no row for it" }];
    return [{ id, status: row.status, error: row.error ?? null, ...(row.detail ? { detail: row.detail } : {}) }];
  });
}

// Engines and pages the sweep can run that have no passing Tool to guard them
// with, and why. The test fails when an entry is no longer needed.
export const UNGUARDED = {
  "server-pdf-compress": "compress-pdf fails on Workers until PDF compression is decided (#244)",
};

// The engines and page handlers of runnable Tools that have no canary and
// aren't in unguarded. Plans carry the engine and handler the current code
// assigns.
export function uncoveredPaths(plans, canaryIds, unguarded = {}) {
  const canaries = new Set(canaryIds);
  const missing = (key) => {
    const paths = new Set(plans.map((plan) => plan[key]).filter(Boolean));
    for (const plan of plans) if (canaries.has(plan.id)) paths.delete(plan[key]);
    for (const label of Object.keys(unguarded)) paths.delete(label);
    return [...paths].sort();
  };
  return { engines: missing("engine"), handlers: missing("handler") };
}

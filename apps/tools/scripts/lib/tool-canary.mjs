// The canary sweep (issue #246): one Tool for each engine and each kind of
// page the Tool sweep runs, checked on every PR by scripts/tool-canary.mjs, so
// a change that breaks an engine fails CI instead of reaching visitors. Each
// entry says what it guards. lib/tool-canary.test.mjs checks that every canary
// passes in benchmarks/tool-sweep-results.json, and that every engine and page
// with a passing Tool has a canary.
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
  "cr2-to-jpg": "ImageMagick WASM, camera RAW input",
  "compress-gif": "ImageMagick WASM image compression",
  "compress-jpg": "jSquash image compression in a worker",
  "batch-compress-png": "batch compression page: several PNGs saved as one ZIP",
  "heic-to-jpg": "HEIC decoder",
  "pdf-to-jpg": "pdf.js rendering",
  "png-to-txt": "Tesseract OCR with its self-hosted assets",
  "jpg-to-docx": "image to Word document",
  "png-to-epub": "image to EPUB",
  "compress-svg": "SVGO",
  "csv-to-json": "table converter page",
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

// The engines and page handlers that have a passing Tool but no canary. Rows
// carry the engine and handler the current code assigns.
export function uncoveredPaths(rows, canaryIds) {
  const canaries = new Set(canaryIds);
  const missing = (key) => {
    const passing = new Set(rows.filter((row) => row.status === "pass" && row[key]).map((row) => row[key]));
    for (const row of rows) if (canaries.has(row.id)) passing.delete(row[key]);
    return [...passing].sort();
  };
  return { engines: missing("engine"), handlers: missing("handler") };
}

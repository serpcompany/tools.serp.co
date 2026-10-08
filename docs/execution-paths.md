# Tool execution paths

Where a Tool's core operation runs: the browser engine for each kind of input,
the format check before a file is saved, and the server routes that remain,
three of which the #224 sweep saw fail on Cloudflare Workers.
[CONTEXT.md](../CONTEXT.md)
defines the client-only, server-assisted and server-executed profiles. Paths
are under `apps/tools/`; [its README](../apps/tools/README.md) maps the app's
other topics.

## In the browser

A Tool's core operation runs in the visitor's browser unless a
[server route](#server-routes) covers it. `lib/convert/workerClient.ts`
dispatches conversion (`convertWithWorker`) and compression (`compressFile`).
Conversion picks an engine by input format:

- **Audio and video:** FFmpeg.wasm (`lib/convert/video.ts`) in its own worker.
  It is single-threaded (`NEXT_PUBLIC_FFMPEG_SINGLE_THREAD`) because the worker
  scripts don't send the COEP headers the multi-threaded build needs. Its 32 MB
  wasm is too big for Workers Static Assets, so it loads from
  `NEXT_PUBLIC_ASSETS_BASE_URL`.
- **AV1 input, and AV1 or HEVC output:** the browser's own codecs (WebCodecs)
  through Mediabunny (`lib/convert/webcodecs.ts`), since FFmpeg.wasm has no
  software AV1 decoder or encoder and its HEVC encoder doesn't finish. FFmpeg
  still reads and writes the containers and does the scaling around the
  browser's steps, handing frames over as near-lossless VP8. A `.av1` output is
  AV1 in IVF and a `.hevc` output a raw Annex B stream, neither with audio. A
  browser without the codec is told which one and to try Chrome or Edge, and
  the run is recorded as handed off, not failed. HEVC input stays on FFmpeg.
- **Camera RAW, PSD, TGA, DDS, TIFF and XCF:** ImageMagick WASM
  (`lib/convert/magickBrowser.ts`) on the main thread. **HEIC and HEIF:**
  libheif.
- **PDF and AI:** pdf.js renders each page, one file per page, at twice its
  size in points but never more than 4096x4096 pixels, Safari's canvas limit.
  Targets other than PNG and JPEG are encoded from that render. AI to PDF
  saves the PDF a PDF-compatible AI file already is, vectors included.
- **Other images:** `workers/convert.worker.js` decodes with the browser and
  encodes with a canvas, retrying on the main thread if the worker fails.
  ImageMagick writes the formats a canvas can't, fitting ICO and CUR inside
  256 px, the largest those formats store; `lib/convert/texture-formats.ts`
  reads and writes ICNS, KTX and KTX2.

Before a converted file is saved, `convertWithWorker` compares its leading bytes
with the promised format (`lib/convert/output-format.ts`). A mismatch fails the
run as `wrong_output_format` and saves nothing. Formats without a reliable
signature, such as TGA, aren't checked, and neither is compression output.

Compression keeps the original bytes when the result would be larger. PNG, JPEG
and WebP use JSquash codecs in `workers/compress.worker.js`; audio and video use
FFmpeg.wasm. Giving a buffer to FFmpeg.wasm transfers it to FFmpeg's worker and
leaves the caller's copy empty, so code that still needs the original reads it
back from FFmpeg's file system. Until #236, missing that made every audio and
video compressor save an empty file. Transcription extracts audio with
FFmpeg.wasm and runs Whisper (transformers.js, loaded from jsDelivr) in
`workers/transcribe.worker.js`.

## Server routes

Server routes run on the Node.js runtime. Native FFmpeg, Ghostscript, Sharp,
gifsicle, `yt-dlp` and similar binaries are not assumed to work in Cloudflare
Workers merely because they work in local Node.js.

- `/api/image-compress`: GIF (gifsicle), SVG (SVGO), and HEIC, HEIF, AVIF and
  TIFF (Sharp) compression, which have no browser path yet. BMP comes back
  unchanged. [Fails on Workers](#routes-that-fail-on-workers).
- `/api/pdf-compress`: PDF compression with Ghostscript.
  [Fails on Workers](#routes-that-fail-on-workers).
- `/api/media-fetch`: pasted links for downloaders and transcription, since
  most media hosts don't allow cross-origin reads from a page. It streams direct
  files and pages an extractor in `lib/extractors` understands; its `yt-dlp`
  fallback needs a native binary.
- `/api/video-convert`: native FFmpeg, tried before FFmpeg.wasm for RM and
  RMVB output, for AMR to MP2, OGG or OGA, and in browsers that can't run
  FFmpeg.wasm (`shouldUseServerConversion`).
  [Fails on Workers](#routes-that-fail-on-workers).
- `/api/image-convert`: still exists, but no Tool has called it since #198.
  [Treat it as failing on Workers](#routes-that-fail-on-workers).

### Routes that fail on Workers

As of the 2026-10-08 sweep, `/api/video-convert`, `/api/image-compress` and
`/api/pdf-compress` fail on Cloudflare Workers. The #224 sweep (commit
`ca5b9a5`, against a local `wrangler dev` Worker) logged unenv `fs`
not-implemented errors (`fs.mkdtemp` in `/api/video-convert`) and a 500 from
every call to them. What a visitor gets depends on the fallback:

- Image and PDF compression have no browser fallback, so those Tools fail. In
  the sweep that was all 7 image compressors that use the route, and Compress
  PDF.
- Video conversion falls back to FFmpeg.wasm when the route fails, if the
  browser can run it. 27 of the 73 video Tools the sweep sent to the route
  still passed that way; nearly all the rest were MXF or RMVB output, which
  failed in FFmpeg.wasm too. Since #236, MXF output converts in FFmpeg.wasm without
  calling the route first.

The sweep didn't measure `/api/image-convert`, because no Tool calls it, but it
creates its temp directory with `fs.mkdtemp` the same way
(`app/api/image-convert/route.ts`), so treat it as failing too.

Issue #147 is moving this work into the browser, or retiring Tools that can't
run there (such as `compress-heic` and `compress-heif`), and then deleting the
routes; PDF compression waits on an owner decision about its browser engine.
Until then, don't count these routes as working server paths.

## Request contracts

The image, video and PDF routes share the server-action cooldown contract in
`lib/server-action-contract.js`. Clients use
`createServerActionRequestHeaders` (`lib/server-action-client.ts`) so the
persistent client id accompanies the request. Downloader requests use their
separate shared contract in `lib/downloader-contract.js`. Production secrets
strengthen cross-instance cookie verification; missing secrets must not be
represented as equivalent production enforcement.

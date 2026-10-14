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
  `NEXT_PUBLIC_ASSETS_BASE_URL`. An M4P protected by Apple's FairPlay (Apple
  Music downloads, older iTunes Store songs) is refused before FFmpeg loads
  (`lib/convert/fairplay.ts`, since #267), since FFmpeg can't decrypt it. A
  `drms` or `drmi` sample entry, Common Encryption's `enca` or `encv`, or a
  `sinf` box inside an entry marks one.
- **Video sizes** (`lib/convert/ffmpeg-args.ts`, since #245): a video output
  that FFmpeg.wasm writes keeps the source's frame size and frame rate, up to
  1920 px on the longer side and 30 fps. A smaller frame isn't scaled up, a
  slower source keeps its rate, and sides are rounded down to even numbers.
  Frames flagged interlaced (1080i camcorder footage, broadcast TS, DVD VOBs)
  are deinterlaced first, one frame for each; progressive frames pass through.
  3GP isn't deinterlaced (its shrink to CIF hides most combing), and neither
  are RM and RMVB, which get no filter until #255 moves them to the browser.
  MXF is always 25 fps, a broadcast rate, and 3GP stays 352x288 at 12 fps,
  since H.263 only encodes fixed frame sizes. A remux, such as MKV to MP4,
  copies the streams as they are. RM and RMVB keep the source size uncapped:
  RealVideo needs sides that are multiples of 16. GIF is at most 480 px on the
  longer side at 15 fps, as the MP4 to GIF page promises: 15 fps is every
  other frame of a 30 or 60 fps source, and a hard-to-compress 10 s 720p clip
  came to 10 MB, against 12 MB at 640 px and 10 fps. The
  [`/api/video-convert` route](#server-routes), tried first for RM and RMVB
  output and in browsers that can't run FFmpeg.wasm, still writes 320 px at
  12 fps. It fails on Workers, so in production FFmpeg.wasm writes RM and
  RMVB as above; #255 removes the route.
- **AV1 input, and AV1 or HEVC output:** the browser's own codecs (WebCodecs)
  through Mediabunny (`lib/convert/webcodecs.ts`), since FFmpeg.wasm has no
  software AV1 decoder or encoder and its HEVC encoder doesn't finish. FFmpeg
  still reads and writes the containers and does the scaling around the
  browser's steps, handing frames over as VP8 within the same limits, at a
  constant rate that a `.hevc` stream records. That VP8's bitrate limit grows
  with the frame: 8 Mbit/s at 720p, 18 at 1080p, and 32 for the largest
  frame the size limit allows (1920x1920); a 40 Mbit/s bound only guards a
  larger limit. Ordinary footage
  comes through near-lossless (median 56 dB PSNR on FFmpeg's `testsrc2` at
  1080p); very detailed frames lose a little (44 dB on `mandelbrot`). A `.av1`
  output is AV1 in IVF and a `.hevc` output a raw Annex B stream, neither with
  audio, and every page that reads or writes one says "video only". A browser
  without the codec is told which one and to try a recent Chrome or Edge on a
  different computer, and the run is recorded as handed off, not failed. HEVC
  input stays on FFmpeg.
- **Camera RAW, PSD, TGA, DDS, TIFF and XCF:** ImageMagick WASM
  (`lib/convert/magickBrowser.ts`) on the main thread, with the LibRaw it
  bundles for camera RAW. Since #269 that's `@imagemagick/magick-wasm` 0.0.42
  (LibRaw 0.22.2): 0.0.37 read Nikon's lossy NEF as all white and Olympus ORF
  as coloured noise. **HEIC and HEIF:** libheif.
- **Netpbm, PCX, JXL, JP2, XPM, WPG, Photo CD, MacPaint, SFW, EXR, HDR and
  fonts** (since #263): ImageMagick WASM too, reading each input with its
  format named, since MacPaint has no signature. ImageMagick repairs an SFW
  (a JPEG with renumbered markers) through a temporary file, which fails in
  WASM, so `lib/convert/sfw.ts` repairs it in memory instead. EXR and HDR
  hold linear light: this 8-bit build clamps values above 1.0 to white as it
  reads, keeping the exposure the file was saved with, and the rest is
  encoded to sRGB (`lib/convert/linear-light.ts`; native `magick` leaves it
  linear, and dark). The 8-bit build rounds linear light to 256 levels before
  encoding it, so dark gradients band where native `magick` keeps them smooth,
  until #275. TTF and OTF become a specimen (`lib/convert/font-specimen.ts`):
  the font's name, A to Z, a to z, digits and a pangram at 16 to 64 px, drawn
  with the font in black on white, grey, as wide as its longest line; a TIFF
  is LZW. As SVG it's that image wrapped, not the font's outlines, until #274.
- **PDF and AI:** pdf.js renders each page, one file per page, at twice its
  size in points but never more than 4096x4096 pixels, Safari's canvas limit.
  Targets other than PNG and JPEG are encoded from that render. AI to PDF
  saves the PDF a PDF-compatible AI file already is, vectors included.
- **Images into documents** (`lib/convert/image-documents.ts`): SVG to HTML
  wraps the drawing in a standalone page; SVG to AI draws it as vectors into a
  PDF page of the drawing's size, one SVG unit to a point as in Illustrator,
  with jsPDF and svg2pdf.js (an AI file is a PDF-compatible
  Illustrator file); an image to EPUB is a one-page EPUB 3 built with fflate.
  Raster images to AI are written as a PDF with the image on one page, and
  ImageMagick writes PCD, which is always 768x512.
- **Images into one PDF** (`lib/convert/image-pdf.ts`, since #277): Image to PDF
  reads any image the engines above read (fonts aside), by the file's first
  bytes, else its extension, and writes one PDF with pdf-lib, a page per image
  in the visitor's order. As in JPG to PDF, a page is its image's size, one
  point a pixel (a side over Acrobat's 14,400 pt is scaled down). A JPEG's image
  data goes in as it is, turned by its EXIF orientation and with its ICC
  profile, without its other metadata (EXIF with GPS, XMP) or what follows the
  image (a Motion Photo's video, a gain map); a CMYK, 12-bit, lossless or
  arithmetic-coded one is decoded instead. An opaque photo in another format
  (HEIC, AVIF, lossy WebP, JPEG XL, JPEG 2000, camera RAW, HDR, EXR) is stored
  as a JPEG at quality 92, and anything else keeps its pixels: Flate, a band of
  rows at a time, with PNG's Paeth predictor when that's smaller on a sample of
  rows, one channel when grey, a soft mask when transparent. The format pages
  (`jpg-to-pdf` and the rest) still embed a PNG with pdf-lib: a 2.3 MB 4032x3024
  JPEG makes a 28 MB PDF there and a 2.3 MB one here. One PDF holds up to 100
  images and 250 MB of image data (`image-pdf-inputs.ts`), since the tab holds
  it about three times over while saving it, and an image it decodes is at most
  50 megapixels. That size is read from the header of a JPEG, PNG, GIF, WebP
  or BMP, and of the PNG ImageMagick writes, before the browser decodes it;
  HEIC, AVIF, ICO, SVG, ICNS and KTX are checked once decoded.
- **Documents to images** (`lib/convert/document-images.ts`, since #250 and
  #265): DOCX, DXF, HTML, plain text, Graphviz DOT, XLSX and PPTX to an image,
  each renderer loaded only when its input is converted, Graphviz and PPTX in
  a worker with a time limit. [document-images.md](document-images.md) says
  how each is drawn, what it leaves out, and why ODT, PostScript and XFig
  don't convert.
- **SVG to TTF** (`lib/convert/svg-font.ts`, since #251): an SVG's filled
  shapes become one TrueType glyph on U+E000, the first Private Use Area code
  point, where icon fonts put theirs, in a font named after the file (plain
  ASCII, else "Icon"). `svg-font-shapes.ts` reads the file with sax: nothing
  in it runs or loads, and only geometry goes on; a `<use>` draws a shape of
  the same file, never another file's. Each shape is filled by its own fill
  rule (from attributes, a stylesheet's simple selectors or a style
  attribute, inherited), then its contours are turned so the font's nonzero
  rule fills what the SVG paints: overlapping shapes all fill, and holes stay
  holes. An even-odd shape whose outlines cross or touch (a star drawn as one
  outline) is first redrawn without crossings by martinez-polygon-clipping
  0.9.0, loaded only then, its curves as lines within a quarter of a font
  unit. A `<use>` of a `<symbol>` with no size fills the viewport it is in,
  and a transform on the root `<svg>` moves the drawing as browsers do, in
  pixels and about the artboard's centre. svgicons2svgfont 16.0.0 flattens
  each shape under one matrix, as lines and curves only (svg-pathdata 9.0.0,
  which it uses, turns an absolute H or V wrongly under a rotation), and
  svg2ttf 6.1.0 writes the font: 1,000 units to the em, the artboard
  (viewBox, else width and height, else the drawing's bounds) its full
  height, 150 below the baseline. Strokes, text, pictures, colours, clipping
  and masks aren't a font's: a stroke is left out with a notice, and a
  stroke-only icon is refused with how to outline it.
  Over 10 MB, 5,000 shapes or 60,000 path commands, or past TrueType's
  65,535 points a glyph, is refused as too detailed (`too_complex`), and so is
  stylesheet matching past 2,000,000 rule checks. A number past a billion
  (1e400 reads as Infinity) gets the damaged-file message with its own code,
  `number_out_of_range`. svg2ttf's point flags overflow on very long runs, so
  the glyph is read back before it's saved.
- **Tables** (`lib/convert/table-outputs.ts`, since #249, and
  `components/table-convert/excel-input.ts`, since #266): the table converter
  pages write Excel, PDF, PNG, JPEG, Avro and Protobuf, name each download
  after the uploaded file, and read Excel workbooks and cells pasted from
  Excel, all in the browser. [table-converters.md](table-converters.md) says
  how each output is written, how the name and the table stay together, and
  how an Excel input is read.
- **Image to text** (`lib/convert/image-text.ts`): JPG and PNG to TXT is OCR
  with tesseract.js, in the browser. Its worker, SIMD LSTM core and English
  model (4.0.0 best_int) are served from `public/vendor/tesseract/`, and a
  test checks the worker and core match the installed packages. JPG and PNG to
  DOCX writes a Word page showing the image at up to the 6.5-inch text width,
  with the `docx` library.
- **BIN** (`lib/convert/bin-image.ts`, since #267): a .bin file is read as
  the image its first bytes say it is (`lib/convert/image-signature.ts`) and
  converted by that format's engine below. Every format the image engines
  read has a signature there, or an entry in its `NO_SIGNATURE` list saying
  why not (MacPaint, fonts); a test fails when an engine gains a format with
  neither. Camera RAW that is TIFF underneath (NEF, ARW, CR2, DNG) goes to
  LibRaw, not the TIFF reader, which would give only its preview. A picture
  in a MacBinary wrapper (a Mac file saved as .bin) is read from its data
  fork. Any other file is refused from its first 4 KB, before the page reads
  the rest, so a disc image of gigabytes is refused at once. A picture is
  reported as damaged (`unreadable_image`) only when its decoder rejects the
  file's bytes (`lib/convert/decode-failure.ts`). For ImageMagick that is any
  failure while it reads the file, once loaded, whatever it throws: LibRaw's
  C++ exceptions arrive as bare numbers and are read by their code in
  LibRaw 0.22.2, the version magick-wasm bundles (a full allocation table is
  the file's), and DDS's reader returns no picture. A ResourceLimitError is
  the file's ("damaged, or too large to convert here") when its header
  declares over about 537 megapixels, and running out of memory otherwise.
  In the browser it is an `<img>` that won't load a format every current
  browser decodes, or AVIF or TIFF when this browser decodes a 1 x 1 sample
  of it (`decode.ts`); without the decoder, ImageMagick reads an AVIF, or
  the page says the browser can't open that format. KTX, ICNS, SFW and HEIF
  readers mark their own. An engine that doesn't load, crashes or runs out
  of memory gets a plain "try again" message, and telemetry keeps that
  engine's code.
- **Other images:** `workers/convert.worker.js` decodes with the browser and
  encodes with a canvas, retrying on the main thread if the worker fails.
  ImageMagick writes the formats a canvas can't, fitting ICO and CUR inside
  256 px, the largest those formats store, and storing a 256 px icon as a PNG
  (`icon:png-compression-size`); `lib/convert/texture-formats.ts`
  reads and writes ICNS, KTX and KTX2.

Before a converted file is saved, `convertWithWorker` compares its leading bytes
with the promised format (`lib/convert/output-format.ts`). A mismatch fails the
run as `wrong_output_format` and saves nothing. Formats without a reliable
signature, such as TGA, aren't checked, and neither is compression output.

Compression keeps the original bytes when the result would be larger. PNG, JPEG
and WebP use JSquash codecs in `workers/compress.worker.js`. Since #147's Lane
4, the other image formats compress on the main thread
(`lib/convert/image-compress.ts`): SVG with SVGO, and GIF, TIFF, BMP and AVIF
with ImageMagick WASM. GIF frames are re-optimised, TIFF pages are rewritten
with LZW, a BMP with at most 256 colours becomes 8-bit RLE, and AVIF is
re-encoded at the chosen quality. For all but AVIF, a result that doesn't
decode to exactly the input's pixels is discarded, and so is any image deeper
than 8 bits a channel, which this ImageMagick build can't hold. An SVG that
isn't UTF-8 is left as it is. Audio and video use FFmpeg.wasm. Giving a buffer to FFmpeg.wasm transfers it to FFmpeg's worker and
leaves the caller's copy empty, so code that still needs the original reads it
back from FFmpeg's file system. Until #236, missing that made every audio and
video compressor save an empty file. Transcription extracts audio with
FFmpeg.wasm and runs Whisper (transformers.js, loaded from jsDelivr) in
`workers/transcribe.worker.js`.

## Server routes

Server routes run on the Node.js runtime. Native FFmpeg, Ghostscript, Sharp,
gifsicle, `yt-dlp` and similar binaries are not assumed to work in Cloudflare
Workers merely because they work in local Node.js.

- `/api/image-compress`: HEIC and HEIF compression with Sharp. Both compress
  Tools are retired, and the other formats compress in the browser, so no live
  Tool calls it. [Fails on Workers](#routes-that-fail-on-workers).
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

- PDF compression has no browser fallback, so Compress PDF fails. So did all 7
  image compressors that used `/api/image-compress` in the sweep; the 5 still
  live now compress in the browser.
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

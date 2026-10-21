// What each engine really does to a file, for `pnpm content:brief` (#356): the
// facts a writer may state on a converter or compressor page, each with the
// code it was read from, and what the code doesn't settle, which copy must
// not claim. Read from the code in October 2026; when an engine changes, fix
// its entry here in the same PR.
//
// `facts` hold for every Tool on the engine, `convert` and `compress` only for
// that operation. FFmpeg command lines aren't restated: the brief runs the builders in
// lib/convert/ffmpeg-args.ts for each Tool, so they can't drift.

import { buildCompressionCommand, buildConvertCommand } from "../../lib/convert/ffmpeg-args.ts";

// HeroConverter (components/HeroConverter.tsx) and lib/convert/workerClient.ts
// run every Tool on the generic converter page, whatever its engine.
export function converterPageFacts(tool) {
  const compress = tool.operation === "compress";
  return [
    "Several files can be chosen at once (the file input is `multiple`, components/HeroConverter.tsx). They run one after another and each downloads as its own file; there is no ZIP.",
    compress
      ? "The compressor asks for quality 0.82 (components/HeroConverter.tsx); the engine below says what that means."
      : tool.to === "pdf"
        ? "Conversions pass no quality setting (components/HeroConverter.tsx)."
        : 'Conversions pass no quality setting (components/HeroConverter.tsx). A conversion that makes several files (a PDF\'s pages) names them "<name>_page1", "<name>_page2"… (lib/convert/workerClient.ts).',
    "There is no general file-size limit (checkInputFile in lib/convert/workerClient.ts checks the format, not the size). Some engines have their own, listed below.",
    'The output is checked against the target format: a wrong result fails with "The converter produced X instead of Y." (lib/convert/workerClient.ts).',
    "The visitor's original file isn't changed; they download a new copy.",
  ];
}

// Engines this file doesn't summarise, and the doc that describes each from
// its code. A brief for one of their Tools carries the doc as an appendix.
export const ENGINE_DOCS = {
  "docx-preview": "docs/document-images.md",
  "pptx-glimpse": "docs/document-images.md",
  "html-render": "docs/document-images.md",
  "text-render": "docs/document-images.md",
  "xlsx-table": "docs/document-images.md",
  "viz-js": "docs/document-images.md",
  "dxf-viewer": "docs/document-images.md",
  "table-convert": "docs/table-converters.md",
  "table-convert + xlsx": "docs/table-converters.md",
  "table-outputs": "docs/table-converters.md",
  "pdfjs-text": "docs/pdf-text.md",
  "text-pdf": "docs/text-pdf.md",
  "xml-pdf": "docs/text-pdf.md",
  "image-documents": "docs/execution-paths.md",
  tesseract: "docs/execution-paths.md",
  docx: "docs/execution-paths.md",
  "svg-font": "docs/execution-paths.md",
};

export const ENGINE_FACTS = {
  "browser-raster": {
    where: "In the browser: a Web Worker, retried on the main thread if the worker fails. No server.",
    facts: [
      "Decodes with the browser's own image decoder (lib/convert/decode.ts) and encodes with a canvas or ImageMagick (lib/convert/encode.ts).",
      "Transparency is kept for PNG and WebP outputs.",
      "An animated input gives its first frame only (decodeWithImageDecoder in lib/convert/decode.ts).",
      "JPEG, WebP and AVIF outputs are written at quality 0.85 (workers/convert.worker.js); PNG has no quality setting.",
      "BMP, GIF, ICO and similar outputs are written by ImageMagick (lib/convert/encode.ts).",
      "Metadata isn't carried over: the image goes through raw pixels, so EXIF, ICC profiles and XMP are dropped (lib/convert/decode.ts, lib/convert/encode.ts).",
      "No size limit of its own.",
      'Errors a visitor can see: "Image decode failed."; "This browser can\'t open … files; try a current Chrome, Edge, Firefox or Safari."',
    ],
    unsettled: [
      "What colour fills transparent areas in a JPG output (the canvas JPEG encoder decides).",
      "Whether EXIF orientation is applied on decode.",
      "How an ICC profile affects the decoded colours.",
    ],
  },
  "imagemagick-wasm": {
    where: "In the browser: ImageMagick compiled to WebAssembly, on the main thread (lib/convert/magickBrowser.ts). No server.",
    facts: [
      "Reads one image: a multi-page TIFF or a layered PSD gives one picture, not one per page or layer.",
      'A picture over about 537 megapixels fails with a "too large to convert here" message (lib/convert/magickBrowser.ts).',
    ],
    convert: ["Conversions set no quality and strip nothing explicitly."],
    compress: [
      "GIF: every frame is re-optimised. TIFF: LZW compression. BMP: RLE8 when the image has no transparency and 256 colours or fewer. AVIF: quality 82 (lib/convert/image-compress.ts).",
      "If the result isn't smaller, the visitor gets the original back (compressImageInBrowser in lib/convert/image-compress.ts).",
      "Nothing is resized.",
    ],
    unsettled: [
      "Which page or layer of a multi-page file is the one kept.",
      "ImageMagick's default quality and transparency handling for each output.",
      "Memory ceilings below 537 megapixels on a phone.",
    ],
  },
  "ffmpeg-wasm": {
    where: "In the browser: FFmpeg compiled to WebAssembly, single-threaded, in its own worker. No server.",
    facts: [
      "No `-map` or `-map_metadata` is passed, so FFmpeg's defaults pick the streams and tags.",
      "No size limit or timeout of its own; a long file takes as long as the visitor's device needs.",
      'Errors a visitor can see: "FFmpeg failed with exit code N" (for example a video with no audio track converted to audio); a FairPlay-protected M4P is refused with its own message.',
    ],
    convert: [
      "Video to GIF: 15 fps, at most 480 px on the longer side, with a generated palette.",
    ],
    compress: [
      "Audio is re-encoded at 160 kbit/s; video with libx264 (preset medium, CRF 24), WebM with VP8 (CRF 38) (buildCompressionCommand at quality 0.82).",
      "If the result isn't smaller, the visitor gets the original back.",
    ],
    unsettled: [
      "Which audio or video track is used when a file has several.",
      "Whether subtitles, chapters and tags survive.",
      "The output sample rate and channel count, where the command doesn't set them.",
      "Memory ceilings: how large a file a phone can convert.",
    ],
  },
  "ffmpeg-wasm + webcodecs": {
    where: "In the browser: the browser's own WebCodecs decoder or encoder for AV1 and HEVC, with FFmpeg.wasm for the rest (lib/convert/webcodecs.ts). No server.",
    facts: [
      '`.av1` and `.hevc` outputs are raw video streams with no audio; the page says "Video only".',
      'A browser without the codec fails with "Your browser can\'t decode …" or "can\'t encode …".',
    ],
    unsettled: ["Which browsers have each codec; it depends on the device and its hardware."],
  },
  "server-video, then ffmpeg-wasm": {
    where:
      "Tries the SERP Tools server first (/api/video-convert), which fails on Cloudflare Workers, then converts in the browser with FFmpeg.wasm (docs/execution-paths.md).",
    facts: [
      "In practice the file is converted in the browser, after a failed upload attempt: copy must not promise either that the file stays on the device or that a server does the work.",
      "After a successful server conversion the page waits 60 s before the next one.",
    ],
    unsettled: ["Whether the server route will work again; until it does, describe only what a visitor sees."],
  },
  pdfjs: {
    where: "In the browser: Mozilla's PDF.js renders each page (lib/convert/pdf.ts). No server.",
    facts: [
      "Every page becomes its own image file; there is no page limit and no ZIP.",
      "Pages render at twice their size, capped at 4096 × 4096 pixels in total (MAX_RENDER_PIXELS).",
      "Backgrounds are opaque white; JPG output is quality 0.9.",
      'An Illustrator file without a PDF inside fails with "This AI file has no PDF inside…".',
    ],
    unsettled: ["How fonts the PDF doesn't embed are drawn."],
  },
  "heif-decoder": {
    where: "In the browser: libheif decodes HEIC and HEIF (lib/convert/heif.ts). No server.",
    facts: [
      "Only the primary image is decoded: a HEIC that holds several images gives one.",
      "Decoded to 8-bit RGB pixels; EXIF data and ICC profiles aren't carried over.",
      "Lossy outputs are written at quality 0.85.",
      'A file with no image fails with "No images in HEIF".',
    ],
    unsettled: ["Whether transparency (an alpha plane) survives."],
  },
  "jsquash-worker": {
    where: "In the browser: jSquash encoders in a Web Worker (workers/compress.worker.js). No server.",
    compress: [
      "JPEG and WebP are re-encoded at quality 82; PNG goes through oxipng at level 1, which is lossless.",
      "If the result isn't smaller, the visitor gets the original back.",
    ],
    unsettled: ["What happens to an animated PNG or WebP."],
  },
  "image-pdf": {
    where: "In the browser (lib/convert/image-pdf.ts). No server.",
    facts: [
      "Several images become one PDF, one page each, in the order the visitor chose.",
      "Limits: 100 images, 250 MB in all, 50 megapixels per image.",
      "Transparency becomes a soft mask; a JPEG goes in as it is, with its ICC profile kept.",
    ],
    unsettled: [],
  },
  svgo: {
    where: "In the browser: SVGO, multipass with its default preset (lib/convert/image-compress.ts). No server.",
    compress: ["If the result isn't smaller, the visitor gets the original back."],
    unsettled: ["Which SVG features the default preset removes from a given file."],
  },
  "server-pdf-compress": {
    where:
      "On the SERP Tools server only, with Ghostscript (app/api/pdf-compress/route.ts). The route fails on Cloudflare Workers (docs/execution-paths.md).",
    compress: ["The file is uploaded; there is no in-browser fallback."],
    unsettled: ["The Ghostscript settings; read the route and ghostscript-node before stating them."],
  },
  "bin-image": {
    where: "In the browser: picks the engine by the file's first 4096 bytes (lib/convert/bin-image.ts). No server.",
    facts: ["A .bin that isn't a picture the page recognises is refused."],
    unsettled: ["Every fact of the engine it hands the file to applies too."],
  },
};


// Facts for every Tool that writes one format (`to`), on the listed engines.
export const TARGET_FACTS = {
  pdf: {
    engines: ["browser-raster", "imagemagick-wasm", "heif-decoder"],
    facts: [
      "Each file becomes its own PDF; several files are never merged into one (the loop in components/HeroConverter.tsx; kind \"single\" in lib/convert/workerClient.ts).",
      "The PDF has one page, the size of the image: 1 pixel is 1 point, with no margin and no A4 or Letter page (encodeFromRGBA in lib/convert/encode.ts).",
      "The picture is embedded losslessly as a PNG (pdf-lib embedPng); the quality setting doesn't apply.",
      "Nothing paints a background: transparent pixels stay transparent in the PDF (stored as a soft mask) (lib/convert/encode.ts).",
    ],
  },
  svg: {
    engines: ["browser-raster"],
    facts: [
      "The picture is not traced to vector shapes. The SVG holds one `<image>` with the picture embedded as a PNG (base64), at the picture's pixel width and height, so it doesn't scale like a vector (encodeFromRGBA in lib/convert/encode.ts).",
      "Nothing is resized or reduced: the full-colour picture is embedded, and transparency is kept in the embedded PNG.",
    ],
  },
  ico: {
    engines: ["browser-raster"],
    facts: [
      "The ICO holds one image, not a set of sizes (writeImage in lib/convert/magickBrowser.ts).",
      "A side over 256 px is fitted inside 256 x 256 with the aspect ratio kept; a smaller image keeps its size. A 256 px image is stored as a PNG inside the ICO (lib/convert/magickBrowser.ts; lib/convert/magickBrowser.test.mjs).",
    ],
    unsettled: ["Whether transparency survives in the ICO (no code strips it and no test checks it)."],
  },
};

// Facts for every Tool that reads one format (`from`), on the listed engines.
export const SOURCE_FACTS = {
  svg: {
    engines: ["browser-raster"],
    facts: [
      "The browser's own decoder draws the SVG, and the output's pixel size is the size the browser reports for it, drawn 1:1. The code adds no scale factor, size cap or viewBox handling (lib/convert/decode.ts).",
      "The code paints no background: the canvas starts transparent, so a PNG output keeps the SVG's transparent areas.",
    ],
    unsettled: ["How an animated or scripted SVG is drawn (the code doesn't handle it)."],
  },
};

const MAGICK_PDF_ROUTE = {
  engines: ["imagemagick-wasm"],
  pdf: "A PDF output is made in two steps: ImageMagick writes a PNG, then the PNG is embedded in the PDF (lib/convert/magickBrowser.ts, lib/convert/workerClient.ts).",
};
SOURCE_FACTS.tiff = SOURCE_FACTS.tif = SOURCE_FACTS.psd = { engines: MAGICK_PDF_ROUTE.engines, facts: [], pdf: MAGICK_PDF_ROUTE.pdf };

// Facts for single Tools, by Tool id.
export const TOOL_FACTS = {
  "mp3-to-mp4": {
    facts: [
      "The command adds no picture of its own (buildConvertCommand in lib/convert/ffmpeg-args.ts): an MP3 without cover art gives an MP4 with audio only, as AAC at 96 kbit/s. Do not call it H.264 video. The command does set `-c:v libx264`, so embedded cover art may come through as a picture stream.",
    ],
    unsettled: ["What happens to cover art embedded in the MP3 (untested)."],
  },
  "gif-to-mp4": {
    facts: ["The command sets no loop option and an MP4 carries no loop flag of its own, so whether the video repeats is up to the player (buildConvertCommand in lib/convert/ffmpeg-args.ts)."],
  },
  "compress-mp4": {
    facts: [
      "Frame size and frame rate aren't changed: the compression command has no scale or frame-rate option (buildVideoCompressionArgs in lib/convert/ffmpeg-args.ts).",
      "The file is written with `-movflags +faststart` (the moov atom moves to the front).",
    ],
  },
  "compress-gif": {
    facts: [
      "Every frame is kept and nothing is resized or reduced in colours: ImageMagick re-optimises how the frames are stored (coalesce, optimizePlus, optimizeTransparency).",
      "The result is used only if it decodes to exactly the same pixels, frame by frame, as the original (samePixels); otherwise, or if it isn't smaller, the visitor gets the original back (compressImageWithMagick in lib/convert/magickBrowser.ts).",
    ],
  },
};

const appliesTo = (entry, engine) => entry && (!entry.engines || entry.engines.includes(engine));

// The facts for one Tool's engine, for an FFmpeg Tool the exact command
// line, and the doc to append when this file has no summary of the engine.
export function engineFactsFor(tool, engine) {
  const entry = ENGINE_FACTS[engine];
  const compress = tool.operation === "compress";
  const facts = entry ? [...(entry.facts ?? []), ...((compress ? entry.compress : entry.convert) ?? [])] : [];
  const unsettled = entry ? [...(entry.unsettled ?? [])] : [];
  if (entry) {
    for (const scoped of [TARGET_FACTS[tool.to], SOURCE_FACTS[tool.from], TOOL_FACTS[tool.id]]) {
      if (!appliesTo(scoped, engine)) continue;
      facts.push(...(scoped.facts ?? []));
      if (scoped.pdf && tool.to === "pdf") facts.push(scoped.pdf);
      unsettled.push(...(scoped.unsettled ?? []));
    }
  }
  let command = null;
  if (engine?.startsWith("ffmpeg-wasm") || engine === "server-video, then ffmpeg-wasm") {
    try {
      const built = compress ? buildCompressionCommand(tool.from, 0.82) : buildConvertCommand(tool.from, tool.to);
      if (!compress) {
        const copies = built.args.some((arg, i) => arg === "-c" && built.args[i + 1] === "copy");
        if (copies) {
          facts.push(
            "This conversion copies the streams without re-encoding (`-c copy`, canRemux in lib/convert/ffmpeg-args.ts): the video and audio aren't re-encoded, and the 1920 px / 30 fps cap doesn't apply, so the picture keeps the source's size and frame rate.",
          );
        } else if (built.args.includes("-fpsmax")) {
          facts.push(
            "The video is re-encoded and keeps the source's frame size and frame rate up to 1920 px on the longer side and 30 fps (MAX_VIDEO_SIZE, MAX_VIDEO_FPS in lib/convert/ffmpeg-args.ts).",
          );
        }
      }
      command = [built.prepass && `ffmpeg ${built.prepass.join(" ")}`, `ffmpeg ${built.args.join(" ")}`].filter(Boolean).join("\n");
    } catch (error) {
      command = `(the command builder threw: ${error.message})`;
    }
  }
  const doc = entry ? null : (ENGINE_DOCS[engine] ?? null);
  let where = entry?.where;
  let missing = [];
  if (!entry && doc) {
    where = `Described in ${doc}, read from its code and appended to this brief.`;
    missing = ["Anything the appended doc doesn't state about this Tool."];
  } else if (!entry) {
    where = "No summary or doc for this engine: read its code before writing any claim about what it does.";
    missing = ["Everything about this engine."];
  }
  return { where, facts, unsettled: entry ? unsettled : missing, command, doc };
}

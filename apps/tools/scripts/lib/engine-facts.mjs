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
import { outputExtension } from "../../lib/convert/output-name.ts";

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
    // Every compression saves "_compressed" with the source extension, whichever
    // engine runs it (the isCompression branch in HeroConverter). The extension
    // comes from lib/convert/output-name.ts, as the download's does.
    compress
      ? `The download is named after the original with "_compressed" added: "<name>_compressed.${outputExtension(tool.from.toLowerCase())}" (components/HeroConverter.tsx).`
      : `The download is named after the original with this Tool's output extension: "<name>.${outputExtension(tool.to)}" (outputFileName in lib/convert/output-name.ts).${outputExtension(tool.to) === tool.to ? "" : ` The extension isn't the Tool's id, ${tool.to}: copy must not say the file ends in .${tool.to}.`} An FFmpeg command below writes a file named "output", which the visitor never sees; copy must not give that name as the download's.`,
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
      "JPEG outputs are written by the canvas at quality 0.85 (workers/convert.worker.js); PNG has no quality setting.",
      "WebP and AVIF outputs are written at quality 0.85 only where the browser's canvas can encode that format. Where it can't, the canvas returns a PNG and ImageMagick encodes the WebP or AVIF from it with no quality set (encodeFromRGBA in lib/convert/encode.ts). Copy must not state one quality for WebP or AVIF output.",
      "BMP, GIF, ICO and similar outputs are written by ImageMagick (lib/convert/encode.ts).",
      "Metadata isn't carried over: the image goes through raw pixels, so EXIF, ICC profiles and XMP are dropped (lib/convert/decode.ts, lib/convert/encode.ts).",
      "The pixels pass through 8-bit RGBA (the RGBA type in lib/convert/heif.ts holds a Uint8ClampedArray), so a canvas output has 8 bits per channel: extra depth in the source, such as a 16-bit PNG or a 10- or 12-bit AVIF, is lost.",
      "No size limit of its own.",
      'Errors a visitor can see: "Image decode failed."; "This browser can\'t open … files; try a current Chrome, Edge, Firefox or Safari."',
    ],
    unsettled: [
      "What color fills transparent areas in a JPG output (the canvas JPEG encoder decides).",
      "Which browsers' canvas can encode WebP or AVIF, and ImageMagick's default quality for each.",
      "Whether EXIF orientation is applied on decode.",
      "How an ICC profile affects the decoded colors.",
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
      "GIF: every frame is re-optimized. TIFF: LZW compression. BMP: RLE8 when the image has no transparency and 256 colors or fewer. AVIF: quality 82 (lib/convert/image-compress.ts).",
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
      "No `-map` or `-map_metadata` is passed, so FFmpeg's defaults pick the streams and copy the input's global tags (title, artist, album and the like) to an output format that can hold them. Checked with @ffmpeg/core 0.12.6: an MP3's title came through an MP3 to MP3 conversion. Copy must not say tags are dropped.",
      "No size limit or timeout of its own; a long file takes as long as the visitor's device needs.",
      "A damaged or cut-short input usually still converts: FFmpeg logs the error and writes what it could read, so the output is shorter. With `-c copy`, a stream the output container can't hold may be dropped or carried as a data stream without any error. Checked with @ffmpeg/core 0.12.6 on cut-short MPEG and CAF files and an MP4 with ALAC audio. Copy must not promise that a bad input or an unsupported stream makes the conversion fail.",
      'Errors a visitor can see: "FFmpeg failed with exit code N" (for example a video with no audio track converted to audio); a FairPlay-protected M4P is refused with its own message.',
    ],
    convert: [
      "Video to GIF: 15 fps, at most 480 px on the longer side with both sides rounded down to an even number (fitWithin), and a generated palette.",
    ],
    compress: [
      "Audio is re-encoded at 160 kbit/s; video with libx264 (preset medium, CRF 24), WebM with VP8 (CRF 38) (buildCompressionCommand at quality 0.82).",
      "If the result isn't smaller, the visitor gets the original back.",
    ],
    unsettled: [
      "Which audio or video track is used when a file has several.",
      "Whether subtitles and chapters survive.",
      "Which tags a given pair of formats can carry across (the output format may have no field for them).",
      "The output sample rate and channel count, where the command doesn't set them.",
      "Memory ceilings: how large a file a phone can convert.",
    ],
  },
  "ffmpeg-wasm + webcodecs": {
    where: "In the browser: the browser's own WebCodecs decoder or encoder for AV1 and HEVC, with FFmpeg.wasm for the rest (lib/convert/webcodecs.ts). No server.",
    facts: [
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
      "Pages render at up to twice their size (scale at most 2). The cap is on area, not on each side: a page is scaled down so it stays within 16,777,216 pixels, about 16.8 megapixels (MAX_RENDER_PIXELS, pageRenderScale in lib/convert/pdf.ts).",
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
      "JPEG outputs are written at quality 0.85. WebP and AVIF are written at 0.85 only where the browser's canvas can encode them; otherwise ImageMagick encodes them with no quality set (encodeFromRGBA in lib/convert/encode.ts).",
      'A file with no image fails with "No images in HEIF".',
    ],
    unsettled: ["Whether transparency (an alpha plane) survives."],
  },
  "jsquash-worker": {
    where: "In the browser: jSquash encoders in a Web Worker (workers/compress.worker.js). No server.",
    compress: [
      "JPEG and WebP are re-encoded at quality 82; PNG goes through oxipng at level 1, which is lossless.",
      "If the worker can't run oxipng (it fails or can't load), PNG falls back to the main thread (compressPngWithWorker, compressPngOnMainThread in lib/convert/workerClient.ts): UPNG reduces the picture to at most 210 colors, which is lossy, and keeps only the first frame of an animated PNG. Copy may call PNG compression lossless only with that exception.",
      "If the result isn't smaller, the visitor gets the original back.",
    ],
    unsettled: ["What happens to an animated PNG or WebP.", "How often the oxipng worker fails in a given browser."],
  },
  "image-pdf": {
    where: "In the browser (lib/convert/image-pdf.ts). No server.",
    facts: [
      "Several images become one PDF, one page each, in the order of the list: images join it in the order they are picked, and the Move up, Move down and Remove buttons change it (components/ImagesToPdfConverter.tsx).",
      "Limits: 100 images, 250 MB in all, 50 megapixels per image.",
      "Transparency becomes a soft mask; a JPEG goes in as it is, with its ICC profile kept.",
      "Each page is its image's size, one point a pixel, with no margin; a side over 14,400 points (200 inches, Acrobat's largest page) is scaled down to fit, keeping every pixel (MAX_PAGE_SIDE).",
      "A JPEG's EXIF orientation turns its page, as a browser shows it; the rest of its EXIF (with GPS) and its XMP are left out. CMYK, 12-bit, lossless and arithmetic-coded JPEGs are decoded instead of going in as they are.",
      "An opaque photo in another photo format (HEIC, HEIF, AVIF, lossy WebP, JPEG XL, JPEG 2000, camera RAW) goes in as a JPEG at quality 92 (PHOTO_QUALITY); every other image (PNG, GIF, BMP, lossless WebP, a transparent photo) goes in as lossless pixels.",
      "An animated GIF or WebP gives its first frame.",
      "It reads JPEG, PNG, GIF, WebP, BMP, AVIF, ICO, SVG, HEIC and HEIF, TIFF, PSD, camera RAW and the other ImageMagick formats (IMAGE_PDF_INPUTS in lib/convert/image-pdf-inputs.ts).",
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
// An entry may be a list, when parts of it hold on different engines. An entry
// marked `convertOnly` is skipped for a compressor, whose command differs.
export const TARGET_FACTS = {
  pdf: [
    {
      engines: ["browser-raster", "imagemagick-wasm", "heif-decoder"],
      facts: [
        "Each file becomes its own PDF; several files are never merged into one (the loop in components/HeroConverter.tsx; kind \"single\" in lib/convert/workerClient.ts).",
        "The PDF has one page, the size of the image: 1 pixel is 1 point, with no margin and no A4 or Letter page (encodeFromRGBA in lib/convert/encode.ts).",
        "The picture is embedded losslessly as a PNG (pdf-lib embedPng); the quality setting doesn't apply.",
      ],
    },
    {
      // ImageMagick writes the PNG on its route, and its transparency
      // handling isn't settled (MAGICK_PDF_ROUTE).
      engines: ["browser-raster", "heif-decoder"],
      facts: [
        "Nothing paints a background: transparent pixels in the decoded picture stay transparent in the PDF (stored as a soft mask) (lib/convert/encode.ts).",
      ],
    },
  ],
  svg: {
    engines: ["browser-raster"],
    facts: [
      "The picture is not traced to vector shapes. The SVG holds one `<image>` with the picture embedded as a PNG (base64), at the picture's pixel width and height, so it doesn't scale like a vector (encodeFromRGBA in lib/convert/encode.ts).",
      "Nothing is resized or reduced: the full-color picture is embedded, and transparency is kept in the embedded PNG.",
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

// WMV, OGV and SWF outputs set no codec (buildConvertCommand in
// lib/convert/ffmpeg-args.ts), so FFmpeg's defaults for the container decide.
// Read from @ffmpeg/core 0.12.6 converting benchmarks/fixtures/sample.mp4.
const defaultCodecs = (container, video, audio) => ({
  facts: [
    `The command sets no codec for ${container}, so FFmpeg's defaults decide: ${video} video and ${audio} audio, at FFmpeg's default bitrates (200 kbit/s video). Checked with @ffmpeg/core 0.12.6.`,
  ],
});
TARGET_FACTS.wmv = defaultCodecs("WMV", "MS-MPEG4 v3 (not Windows Media Video)", "WMA v2 (128 kbit/s)");
TARGET_FACTS.ogv = defaultCodecs("OGV", "Theora", "Vorbis");
TARGET_FACTS.swf = defaultCodecs("SWF", "Sorenson Spark (FLV1)", "MP3");
// buildConvertCommand asks for 192k; compress-mp3 runs buildCompressionCommand (160k).
TARGET_FACTS.mp3 = {
  engines: ["ffmpeg-wasm", "server-video, then ffmpeg-wasm"],
  convertOnly: true,
  facts: [
    "MP3 outputs ask for 192 kbit/s, which MP3 can't reach below 32 kHz: LAME then writes at most 160 kbit/s (16 to 24 kHz) or 64 kbit/s (8 to 12 kHz). The sample rate isn't changed, so an 8 kHz source (GSM, telephone ULAW or A-law) gives an MP3 of about 64 kbit/s. Checked with @ffmpeg/core 0.12.6. Copy must not promise 192 kbit/s for every source.",
  ],
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
// An SVG is drawn from a blob as an image (decodeInBrowser in lib/convert/decode.ts),
// and a browser loads nothing outside an SVG drawn as an image.
SOURCE_FACTS.svg.facts.push(
  "The SVG is drawn as an image, so the browser loads nothing outside the file: a linked picture, an external stylesheet or a web font it points to is never drawn, whether or not it is online. Only what is embedded in the SVG (data: URIs, inline styles) and fonts installed on the visitor's device appear.",
);

const MAGICK_PDF_ROUTE = {
  engines: ["imagemagick-wasm"],
  pdf: "A PDF output is made in two steps: ImageMagick writes a PNG, then the PNG is embedded in the PDF (lib/convert/magickBrowser.ts, lib/convert/workerClient.ts).",
};
// What the route leaves open, for a PDF output only.
const MAGICK_PDF_UNSETTLED = [
  "Whether transparency survives in the PDF: ImageMagick writes the PNG that is embedded, and its transparency handling isn't settled. Copy must claim neither a transparent nor a filled background.",
  "Which page of a multi-page TIFF, or which layer of a PSD (the merged image or a single layer), ends up in the PDF. Copy must not name it.",
];
SOURCE_FACTS.tiff = SOURCE_FACTS.tif = SOURCE_FACTS.psd = {
  engines: MAGICK_PDF_ROUTE.engines,
  facts: [],
  pdf: MAGICK_PDF_ROUTE.pdf,
  pdfUnsettled: MAGICK_PDF_UNSETTLED,
};

// A raw .hevc or .av1 file is a video stream with no container and no audio,
// whichever engine converts it (videoOnlyNote in lib/convert/webcodecs.ts).
for (const raw of ["hevc", "av1"]) {
  SOURCE_FACTS[raw] = {
    facts: [
      `A .${raw} input is a raw video stream with no audio track, so the output has no sound: copy must not promise audio, whatever audio options the command sets. The page says "Video only" (videoOnlyNote in lib/convert/webcodecs.ts).`,
    ],
  };
  TARGET_FACTS[raw] = {
    facts: [`A .${raw} output is a raw video stream with no audio; the page says "Video only" (videoOnlyNote in lib/convert/webcodecs.ts).`],
  };
}

// The JPEG compressor (compressJpeg in workers/compress.worker.js) calls
// @jsquash/jpeg's decode and encode with only a quality, so their defaults
// (meta.js) decide the rest.
const JPEG_COMPRESS = {
  engines: ["jsquash-worker"],
  facts: [
    "The JPEG is decoded and encoded again with MozJPEG (@jsquash/jpeg) at its defaults apart from quality: a progressive JPEG with optimized Huffman tables. The width and height don't change.",
    "The image goes through raw pixels, so EXIF (with GPS), the ICC profile and XMP are not in the result.",
    "EXIF orientation isn't applied on decode (decodeJpeg is called without preserveOrientation, which defaults to false) and the tag is dropped, so a photo that stands upright only through its orientation tag comes out turned (unless the original comes back because the result isn't smaller). Copy must not claim the orientation is kept.",
  ],
};

// Facts for single Tools, by Tool id.
export const TOOL_FACTS = {
  "compress-jpg": JPEG_COMPRESS,
  "compress-jpeg": JPEG_COMPRESS,
  "mp3-to-mp4": {
    facts: [
      "The command adds no picture of its own (buildConvertCommand in lib/convert/ffmpeg-args.ts): an MP3 without cover art gives an MP4 with audio only, as AAC at 96 kbit/s. Do not call it H.264 video. The command does set `-c:v libx264`, so embedded cover art may come through as a picture stream.",
    ],
    unsettled: ["What happens to cover art embedded in the MP3 (untested)."],
  },
  "m4a-to-mp3": {
    facts: [
      "`-vn` leaves out every video stream, and FFmpeg reads cover art embedded in an M4A as one, so the MP3 has no cover art (buildConvertCommand in lib/convert/ffmpeg-args.ts).",
    ],
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
      "Every frame is kept and nothing is resized or reduced in colors: ImageMagick re-optimizes how the frames are stored (coalesce, optimizePlus, optimizeTransparency).",
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
    for (const scoped of [TARGET_FACTS[tool.to], SOURCE_FACTS[tool.from], TOOL_FACTS[tool.id]].flat()) {
      if (!appliesTo(scoped, engine) || (compress && scoped.convertOnly)) continue;
      facts.push(...(scoped.facts ?? []));
      if (scoped.pdf && tool.to === "pdf") facts.push(scoped.pdf);
      unsettled.push(...(scoped.unsettled ?? []));
      if (tool.to === "pdf") unsettled.push(...(scoped.pdfUnsettled ?? []));
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
            "The video is re-encoded and keeps the source's frame size and frame rate up to 1920 px on the longer side and 30 fps (MAX_VIDEO_SIZE, MAX_VIDEO_FPS in lib/convert/ffmpeg-args.ts). A smaller frame is never scaled up and a slower rate is never raised; a faster source has frames dropped (-fpsmax) and keeps its length, so it is not slowed down. Both sides are rounded down to an even number (force_divisible_by=2 in fitWithin), so an odd width or height loses 1 px: copy must not say the size is kept exactly.",
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

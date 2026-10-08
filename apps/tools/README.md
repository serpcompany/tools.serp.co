# Tools application contract

`apps/tools` owns the public `tools.serp.co` application: routes, rendering,
Tool execution, API handlers, metadata, sitemaps, and the Cloudflare/OpenNext
assembly. Repository-wide orchestration remains owned by the root harness.

## Catalog and discovery

The versioned Tool registry at `lib/catalog/tools.json` is the canonical
source of shipped catalog intent. Registry `id` is the stable identity.
`isActive` represents publication intent; it does not prove implementation,
verification, or runtime health. Code reads it through `lib/catalog/catalog.ts`;
`lib/catalog/validate.ts` checks its shape in tests and `pnpm verify:catalog`,
never at runtime.

`OPERATIONS` in `lib/catalog/operations.ts` lists the operation values in
display order: `convert`, `download`, `compress`, `combine`, `bulk`, `edit`,
`video-editor`, `image-editor`, `audio-editor`, and `view`. Each editor
operation holds one "coming soon" placeholder Tool. Category pages use
`/category/{operation}/`, and `/categories/` links to the active operation
categories. Category routes keep dynamic parameters enabled for OpenNext
compatibility, validate the operation, and return `notFound()` for invalid or
empty categories.

Active Tools drive public discovery, metadata, and sitemap projections. The
homepage grid, `/categories/`, the category pages and the link hub read their
lists from `lib/catalog/directory.ts` in Server Components, which pass client
components plain data as props. Props are serialized into every page that
renders them, so each entry carries only what the client renders or filters
on, and `lib/catalog/directory.test.mjs` pins the shapes. A client module, or
anything it imports, must not import the catalog: Next.js would ship the 4 MB
registry to the browser. `lib/catalog/client-boundary.test.mjs` fails if one
does.

## Sitemaps

`lib/sitemap.ts` builds a flat tree per the serp
[sitemap standard](https://github.com/serpcompany/serp/blob/main/docs/engineering/websites/features/xml-sitemaps.md):
`/sitemap-index.xml` lists only root-level `/sitemap-{pages,tools,categories}.xml`
URL sets (`-2`, `-3`... past 50,000 URLs). The homepage entry is the bare origin
and other entries end in `/`. Deployed environments write their canonical
origin, local runs the request origin. `/sitemap.xml` and retired names
(`/sitemap-0.xml`, `/tools-index.xml`, `/tools-0.xml`) 308 into the tree.

## Rendering and shared page behavior

- Standard Tools use the shared Tool page renderer and template.
- Specialized Tools may use custom renderers, but their registry identity and
  public route still come from the canonical catalog intent.
- `packages/app-core/src/data/related-apps.json` owns Related App entries;
  matching uses a Tool's input and output formats and de-duplicates by app id.
- The shared site footer is mounted by
  `packages/app-core/src/components/app-layout.tsx`. Do not add a second page
  footer without an intentional product-specific reason.
- The Tool link hub groups by canonical operation and initially shows at most
  48 links in its active category.

## Execution paths

A Tool's core operation runs in the visitor's browser unless a server route
below covers it. `lib/convert/workerClient.ts` dispatches conversion
(`convertWithWorker`) and compression (`compressFile`). Conversion picks an
engine by input format:

- **Audio and video:** FFmpeg.wasm (`lib/convert/video.ts`) in its own worker.
  It is single-threaded (`NEXT_PUBLIC_FFMPEG_SINGLE_THREAD`) because the worker
  scripts don't send the COEP headers the multi-threaded build needs. Its 32 MB
  wasm is too big for Workers Static Assets, so it loads from
  `NEXT_PUBLIC_ASSETS_BASE_URL`.
- **Camera RAW, PSD, TGA, DDS, TIFF and XCF:** ImageMagick WASM
  (`lib/convert/magickBrowser.ts`) on the main thread. **HEIC and HEIF:**
  libheif. **PDF and AI:** pdf.js, one file per page.
- **Other images:** `workers/convert.worker.js` decodes with the browser and
  encodes with a canvas, retrying on the main thread if the worker fails.
  ImageMagick writes the formats a canvas can't, and
  `lib/convert/texture-formats.ts` reads and writes ICNS, KTX and KTX2.

Before a converted file is saved, `convertWithWorker` compares its leading bytes
with the promised format (`lib/convert/output-format.ts`). A mismatch fails the
run as `wrong_output_format` and saves nothing. Formats without a reliable
signature, such as TGA, aren't checked, and neither is compression output.

Compression keeps the original bytes when the result would be larger. PNG, JPEG
and WebP use JSquash codecs in `workers/compress.worker.js`; audio and video use
FFmpeg.wasm. Transcription extracts audio with FFmpeg.wasm and runs Whisper
(transformers.js, loaded from jsDelivr) in `workers/transcribe.worker.js`.

Server routes run on the Node.js runtime. Native FFmpeg, Ghostscript, Sharp,
gifsicle, `yt-dlp` and similar binaries are not assumed to work in Cloudflare
Workers merely because they work in local Node.js.

- `/api/image-compress`: GIF (gifsicle), SVG (SVGO), and HEIC, HEIF, AVIF and
  TIFF (Sharp) compression, which have no browser path yet. BMP comes back
  unchanged.
- `/api/pdf-compress`: PDF compression with Ghostscript.
- `/api/media-fetch`: pasted links for downloaders and transcription, since
  most media hosts don't allow cross-origin reads from a page. It streams direct
  files and pages an extractor in `lib/extractors` understands; its `yt-dlp`
  fallback needs a native binary.
- `/api/video-convert`: native FFmpeg, tried before FFmpeg.wasm for MXF, RM and
  RMVB output, for AMR to MP2, OGG or OGA, and in browsers that can't run
  FFmpeg.wasm (`shouldUseServerConversion`).
- `/api/image-convert`: still exists, but no Tool has called it since #198.

The image, video and PDF routes share the server-action cooldown contract in
`apps/tools/lib/server-action-contract.js`. Clients use
`createServerActionRequestHeaders` so the persistent client id accompanies the
request. Downloader requests use their separate shared contract in
`apps/tools/lib/downloader-contract.js`. Production secrets strengthen
cross-instance cookie verification; missing secrets must not be represented as
equivalent production enforcement.

## Downloader Landers

All active `download` Tools use the shared downloader template and request
path. Dedicated Landers normally use `download-*` slugs and inherit the shared
extension CTA, action-triggered ad gate, modal, and rate limit. The page's
countdown starts when an attempt ends; the server's limit starts at a successful fetch.
The generic `/video-downloader/` route remains the broad multi-source entry point.

Downloads deliberately use this site's own `/api/media-fetch`, not the shared
`https://api.serp.co/download/` that the serp downloader-tools standard names
(owner decision, 2026-10-07, issue #169).

Outbound Product links are curated data, never derived from Tool ids or slugs.
Downloader Lander link changes must follow
[`docs/agents/downloader-lander-links.md`](../../docs/agents/downloader-lander-links.md).

## Ads

Ad placement is centralized in `apps/tools/components/ToolAds.tsx`; the script
is mounted by the shared app layout. Tool and downloader ads remain hidden
until the user initiates the relevant action. Rail ads are hidden below the
`xl` breakpoint. Ads load only in a production build
(`NEXT_PUBLIC_SITE_ENV=production`, set by `cf:build:production`);
`NEXT_PUBLIC_ADSENSE_TEST_MODE=true` enables test ads in any other build. Other
`NEXT_PUBLIC_ADSENSE_*` variables configure client and slot overrides.

## Fixtures and verification

Benchmark fixtures and their declared coverage live under
`apps/tools/benchmarks`. `fixture-matrix.json` is keyed by input format and
records `ready` or `missing`; custom Tool fixtures live under `toolFixtures`.
Fixtures are reusable inputs, not proof that a Tool works.

For deterministic verification from the repository root, run `pnpm test`.
Application-only checks are `pnpm -C apps/tools lint` and
`pnpm -C apps/tools typecheck`. Benchmark, browser, deployed-environment, and
network-backed checks are separate operations and must not be described as
part of the deterministic test result.

`pnpm -C apps/tools render-snapshot snapshot --base-url <url> --out <dir>`
records every page, sitemap file and redirect a running Worker serves;
`render-snapshot diff <base> <head>` exits 1 if a refactor changed any of them.
Build both the same way; only `cf:build:production` covers ads and indexing.

`pnpm -C apps/tools tool-sweep --base-url http://localhost:8787` runs every
active converter and compressor Tool once in headless Chromium against a local
Worker (started as in [the browser smoke runbook](../../docs/runbooks/browser-smoke.md)),
checks each saved file with `lib/convert/output-format.ts` and writes
`benchmarks/tool-sweep-results.json`. `--resume` continues an interrupted run;
`--summary` prints the Markdown table. It measures; it isn't part of `pnpm check`.

## Adding a Tool

1. Add or update the registry entry with a stable Tool id, route, operation,
   handler, formats, publication intent, and content.
2. Reuse a shared renderer unless the Tool has genuinely specialized behavior.
3. Add representative fixture coverage where practical and contract tests for
   the public behavior being introduced.
4. Verify routes, category membership, metadata, sitemap membership, action
   completion, and output semantics through the highest stable interface.
5. Run the deterministic repository checks. Run the scoped network link check
   as well when downloader outbound links changed.

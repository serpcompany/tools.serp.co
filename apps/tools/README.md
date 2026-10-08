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

Active Tools drive public discovery, metadata, and sitemap projections. Keep
directory payloads plain-data safe when passing from Server Components to
client components.

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

Browser conversion and compression use the worker client and workers under
`apps/tools/workers`. Server-required conversion paths are explicit API routes
for image conversion, image compression, video conversion, PDF compression,
and public-media fetching. Native FFmpeg, ImageMagick, Ghostscript, `yt-dlp`,
and similar binaries are not assumed to work in Cloudflare Workers merely
because they work in local Node.js.

Compression keeps the original bytes when the result would be larger. Browser
image compression uses JSquash codecs; server image compression uses the
route-specific Sharp, gifsicle, and SVGO paths; media compression uses FFmpeg;
PDF compression uses Ghostscript and qpdf.

Server-required conversion APIs share the server-action cooldown contract in
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

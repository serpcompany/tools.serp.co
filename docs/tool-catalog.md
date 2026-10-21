# Tool catalog and pages

How the Tool registry becomes the public site: the registry, operations and
category routes, the discovery lists and what client code may import, sitemaps,
shared page rendering, and the checklist for adding a Tool. Paths are under
`apps/tools/` unless they start with `packages/`.
[apps/tools/README.md](../apps/tools/README.md) maps the app's other topics.

## Registry

The versioned Tool registry at `lib/catalog/tools.json` is the canonical
source of shipped catalog intent. Registry `id` is the stable identity.
`isActive` represents publication intent; it does not prove implementation,
verification, or runtime health. Code reads it through `lib/catalog/catalog.ts`;
`lib/catalog/validate.ts` checks its shape in tests and `pnpm verify:catalog`,
never at runtime.

## Operations and categories

`OPERATIONS` in `lib/catalog/operations.ts` lists the operation values in
display order: `convert`, `download`, `compress`, `combine`, `bulk`, `edit`,
`video-editor`, `image-editor`, `audio-editor`, and `view`. Each editor
operation holds one "coming soon" placeholder Tool. Category pages use
`/category/{operation}/`, and `/categories/` links to the active operation
categories. A category lists its Tools 120 to a page in registry order
(`lib/catalog/category-pages.ts`): page 1 is `/category/{operation}/`, page
`n` from 2 is `/category/{operation}/{n}/`, `/1/` redirects (308) to page 1,
and a number past the last page is a 404. Registry order is `tools.json`'s,
which is kept in id order, so a new Tool goes in at its id's place, not at the
end. A Tool added or retired moves every later Tool by one place: pages before
it don't change, and one Tool crosses each later page boundary. #328's three
PDF Tools, for example, moved the last three Tools of converter pages 15 to 18
to the next page. Every page links every other, so
each Tool is three clicks from the homepage. Category routes keep dynamic
parameters enabled for OpenNext compatibility, validate the operation, and
return `notFound()` for invalid or empty categories.

## Discovery lists and the client boundary

Active Tools drive public discovery, metadata, and sitemap projections. The
homepage, `/categories/`, the category pages and the link hub read their
lists from `lib/catalog/directory.ts` in Server Components, which pass client
components plain data as props. Props are serialized into every page that
renders them, so each list is bounded, each entry carries only what the client
renders or filters on, and `lib/catalog/directory.test.mjs` pins the shapes
and byte budgets. Only the homepage search needs every Tool: it fetches
`/tool-index.json` (`app/tool-index.json/route.ts`) the first time someone
searches or filters, so no page inlines the full list.

Nothing a `"use client"` module or a web worker imports may reach
`lib/catalog/catalog.ts`, `lib/catalog/directory.ts` or `tools.json`, directly
or through other modules, or Next.js ships the 4 MB registry to the browser.
The registry-free catalog modules (`icons.ts`, `href.ts`, `operations.ts`)
are fine to import there. `lib/catalog/client-boundary.test.mjs` fails on a
leak, and on an `import()` or `require()` it can't follow.

Dense link lists (the link hub, related Tools, Tool cards) set
`prefetch={false}`: each prefetch downloads the target page's payload, link hub
included.

## Sitemaps

`lib/sitemap.ts` builds a flat tree per the serp
[sitemap standard](https://github.com/serpcompany/serp/blob/main/docs/engineering/websites/features/xml-sitemaps.md):
`/sitemap-index.xml` lists only root-level `/sitemap-{pages,tools,categories}.xml`
URL sets (`-2`, `-3`... past 50,000 URLs). The homepage entry is the bare origin
and other entries end in `/`. `/sitemap-categories.xml` lists every numbered
page of every category. Deployed environments write their canonical
origin, local runs the request origin. `/sitemap.xml` and retired names
(`/sitemap-0.xml`, `/tools-index.xml`, `/tools-0.xml`) 308 into the tree.

## Rendering and shared page behavior

- Standard Tools use the shared Tool page renderer and template.
- Pages render without their query on Workers (`lib/page-request.ts`), so
  server code must not read it; client code reads `location.search`.
- Image to PDF (`from: "image"`, `to: "pdf"`) is a standard Tool whose hero is
  `ImagesToPdfConverter`: one image becomes a PDF at once, as on every
  converter, and several are listed to order before they become one PDF.
- Specialized Tools may use custom renderers, but their registry identity and
  public route still come from the canonical catalog intent.
- The Related Tools section on converter and compressor pages
  (`lib/catalog/related-tools.ts`) lists a Tool's curated
  `content.relatedTools` as written. Without one, it lists at most 24 active
  Tools of the same kind that share a registry format (converters and
  compressors, never a Lander): the reverse pair, then the same source format,
  the same target format and the other shared-format Tools. The same source and
  same target groups share the places; the others fill what is left. Which
  Tools fill a group's places is fixed per page by a hash of the two Tool ids;
  they show sorted by id. Table converter and transcription pages render no
  such section. Every converter and compressor page is on a list another page
  renders, except table converter pages with a "More Table Converters" section
  (87 of the 88; `/html-to-markdown/` has none): each of those links the other
  87, so one of them on a list reaches them all.
- Lander pages (`DownloaderPageTemplate`) render the same section with 8
  other active Landers, adult-site and mainstream mixed (owner decision on
  #349, 2026-10-19). In id order the Landers form a ring, and each lists the
  Landers a fixed stride apart (their number divided by 9, rounded down), so
  every Lander is on exactly 8 Landers' lists, beside its category page.
  Adding or retiring one Lander shifts the ring, so most lists change
  (retiring TellaTV, #321, changed 256 of the other 291); that is expected. Run
  `node scripts/lander-links.mjs --base-url <url> --min 3` in `apps/tools`
  against a production build or the site to count each Lander's followed
  incoming links from the sitemap's pages; a local `cf:build` is nofollow
  and credits none.
- `packages/app-core/src/data/related-apps.json` owns Related App entries;
  matching uses a Tool's input and output formats and de-duplicates by app id.
- Tool pages and Landers (`ToolPageTemplate`, `DownloaderPageTemplate`) carry
  one `<script type="application/ld+json">` from `lib/structured-data.ts`: a
  free `WebApplication` (the page's H1 and subtitle, its canonical URL). It
  has no `Review`, `AggregateRating`, `FAQPage` or `HowTo` markup: Lander
  reviews have no verifiable source, FAQ rich results are limited to
  government and health sites, and HowTo rich results are retired. It has no
  `BreadcrumbList` either, because no page shows a breadcrumb trail. Tool
  pages outside the two templates (table converters, transcription, PDF and
  others) have none yet; #337 tracks them.
- The shared site footer is mounted by
  `packages/app-core/src/components/app-layout.tsx`. Do not add a second page
  footer without an intentional product-specific reason.
- The Tool link hub groups by canonical operation. Each tab is sent and shows
  at most 48 links (popular, then new, then by name) and links its category's
  pages for the rest. Only the active tab's links are in the HTML.
- The homepage shows the first 8 Tools of each category in the same order,
  with a link to the category.
- Downloaders, on the homepage and in the link hub's tab, instead shows the 8
  Landers in `lib/catalog/homepage-downloaders.json`, in its order: the most
  Search Console clicks, adult sites left out by name (owner decisions on
  #326). Its `source`, `period` and `readOn` say where the clicks come from.
  When one of them is retired or renamed, `directory.test.mjs` fails: replace
  it with the next Lander by clicks that isn't for an adult site. Every other
  Lander is on the Downloaders category pages.

## Titles, descriptions and share images

`lib/metadata.ts` builds the Tool, category, `/categories/` and `/brands/`
pages' metadata, and `lib/table-convert.ts` the table converters'. Both use
`lib/page-metadata.ts`, which also holds the homepage's and the root layout's
and reads no registry. A page sets only its own title: the layout's template
adds " | SERP Tools". The homepage sets its full title, and keeps its
slashless canonical and `og:url` in `app/page.tsx`. Every public `page.tsx`
exports its own metadata; the layout's neutral `SERP Tools` defaults reach only
the noindex 404s and the internal dashboard.

- A converter or compressor's title and H1 follow the owner's pattern, "WebP
  to PNG Converter (Free, Online)" and "WebP to PNG Converter", generated by
  `toolSeo` unless the Tool's `content.seo` replaces them. Its copy is written
  and checked as [converter-copy.md](converter-copy.md) says.
- A description is at most 160 characters. It starts with the curated
  subtitle or the registry description, cut at a sentence, then adds true
  facts while it is under 120: whether the converter page keeps the file in
  the browser (not for the server-first conversions in `lib/capabilities.ts`,
  PDF compression or a Tool in `TOOLS_WITH_OWN_PAGE`), "free, with no
  sign-up", and what to do on the page. Placeholders say they are coming soon.
- Each page family has a 1200x630 share image (`og:image`, `twitter:image`)
  under `public/og/`, listed in `lib/share-images.ts`. After changing that
  list, run `pnpm -C apps/tools share-images` and commit the PNGs.
- `lib/metadata.test.mjs` checks the lengths, that no two pages share a
  description, the images, where the browser claim appears, and that every
  public page exports its metadata.

## Adding a Tool

1. Add or update the registry entry with a stable Tool id, route, operation,
   handler, formats, publication intent, and content.
2. Reuse a shared renderer unless the Tool has genuinely specialized behavior.
3. Add representative [fixture](runbooks/tool-verification.md#fixtures)
   coverage where practical and contract tests for the public behavior being
   introduced.
4. Verify routes, category membership, metadata, sitemap membership, action
   completion, and output semantics through the highest stable interface.
5. Run `pnpm -C apps/tools tool-status` and commit the regenerated
   `benchmarks/tool-status.csv` and `tool-status-summary.md`. A new Tool shows
   `not swept` until the [Tool sweep](runbooks/tool-verification.md#tool-sweep)
   measures it; the sweep then records its status and processing location.
6. Run the deterministic repository checks. Run the scoped network link check,
   `pnpm check:links`, as well when downloader outbound links changed.

## Retiring a Tool

1. Set `isActive: false` on its registry entry. It leaves the sitemap, and
   middleware answers it with `410 Gone` (noindex, `no-store`) when
   `data/keywords.csv` has rows for its operation (today `convert` and
   `compress`) and none joins its id with a global volume above 0. A retired
   Tool with demand, or of an operation the file has no rows for (a
   downloader Lander, an editor, a viewer), 404s from the shared `[tool]`
   route until it is rebuilt or dropped (owner decision D3, #322).
   `scripts/gone-tool-routes.mjs` derives the 410 list before every build and
   dev run and never commits it, so making the Tool active again ends its
   410. The entry stays as the record of the retirement. A Tool with its own
   folder under `app/` (a table converter's `TableConvertLanding`, or a page
   such as `cr3-to-jpg`) has the folder deleted, and its entry removed from
   lists such as `lib/table-convert-pages.ts`, in the same change: a folder
   left for a Tool on the 410 list fails `lib/gone-tool-routes.test.mjs`, and
   one left for a Tool that 404s keeps serving, since a page there may render
   without checking the catalog.
2. Drop its rows from `benchmarks/tool-sweep-results.json`, as the next sweep
   would: keep only active Tools' rows (`mergeRows` with no new rows) and
   recount `meta.counts`. `pnpm test` fails while a retired Tool keeps a row.
3. Run `pnpm -C apps/tools tool-status` and commit the regenerated view.
4. If it is in `CANARY_TOOLS` (`scripts/lib/tool-canary.mjs`), replace it with
   another passing Tool on the same engine; `pnpm test` fails until you do.

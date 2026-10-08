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
categories. Category routes keep dynamic parameters enabled for OpenNext
compatibility, validate the operation, and return `notFound()` for invalid or
empty categories.

## Discovery lists and the client boundary

Active Tools drive public discovery, metadata, and sitemap projections. The
homepage grid, `/categories/`, the category pages and the link hub read their
lists from `lib/catalog/directory.ts` in Server Components, which pass client
components plain data as props. Props are serialized into every page that
renders them, so each entry carries only what the client renders or filters
on, and `lib/catalog/directory.test.mjs` pins the shapes and byte budgets.

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

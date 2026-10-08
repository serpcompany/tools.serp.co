# Tools application contract

`apps/tools` owns the public `tools.serp.co` application: routes, rendering,
Tool execution, API handlers, metadata, sitemaps, and the Cloudflare/OpenNext
assembly. Repository-wide orchestration remains owned by the root harness.

This README maps the app's topics. Each lives in its own doc; open the one
your change touches.

## Topics

**Catalog, routes and pages.** [docs/tool-catalog.md](../../docs/tool-catalog.md)
covers the Tool registry, operations and category routes, the discovery lists
and what client code may import, sitemaps, shared page rendering, and the
checklist for adding a Tool. Read it before adding or changing a Tool, a
category, a sitemap or a shared page section.

**Where a Tool runs.** [docs/execution-paths.md](../../docs/execution-paths.md)
says which browser engine handles each input, how output is checked before it
is saved, which server routes remain, which of them fail on Cloudflare
Workers, and the request contracts they share. Read it before changing an
engine, a worker or an API route.

**Downloader Landers.** [docs/downloader-landers.md](../../docs/downloader-landers.md)
covers the shared downloader template and rate limit, why downloads use this
site's own `/api/media-fetch`, and where outbound links come from. Read it
before adding or changing a downloader Tool or Lander. A change to outbound
links follows
[docs/agents/downloader-lander-links.md](../../docs/agents/downloader-lander-links.md).

**Ads.** [docs/ads.md](../../docs/ads.md) says where ads are placed, when they
show, and which builds load them. Read it before changing an ad slot or the
build environment.

**Fixtures and verification.**
[docs/runbooks/tool-verification.md](../../docs/runbooks/tool-verification.md)
covers the benchmark fixtures, the deterministic checks, the render snapshot
that proves a refactor changed no page, and the sweep that runs every
converter and compressor. Read it before claiming a Tool works or that a
refactor changed nothing.

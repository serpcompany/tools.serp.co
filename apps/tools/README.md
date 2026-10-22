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

**How-to videos.** [docs/videos.md](../../docs/videos.md) covers a Tool's
how-to video: its registry record, the converter page's player, the watch
page, the `/videos/` library, the video sitemap, and how to add a video.

**Converter copy.** [docs/converter-copy.md](../../docs/converter-copy.md)
is the style guide for converter and compressor pages: titles and H1s from
the keyword, descriptions, FAQs and pair notes, what copy may claim, and the
`content:brief`, `content:check` and `content:apply` commands, the only way
copy reaches the registry. Read it before writing or changing that copy.

**Where a Tool runs.** [docs/execution-paths.md](../../docs/execution-paths.md)
says which browser engine handles each input, how output is checked before it
is saved, which server routes remain, which of them fail on Cloudflare
Workers, and the request contracts they share. Read it before changing an
engine, a worker or an API route.
[docs/document-images.md](../../docs/document-images.md) covers the documents,
text, graphs, workbooks and slides drawn as images, and the inputs that can't
be.
[docs/table-converters.md](../../docs/table-converters.md) covers the table
converter pages: the files they write, how downloads are named, and Excel
input. [docs/pdf-text.md](../../docs/pdf-text.md) covers PDF to TXT, HTML and
EPUB: how the text is read, the files written, and the PDFs refused.
[docs/text-pdf.md](../../docs/text-pdf.md) covers TXT and XML to PDF: the page,
the fonts, the XML listing, and the files refused.

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

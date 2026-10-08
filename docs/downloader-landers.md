# Downloader Landers

How download Tools and their Landers share one template and request path, why
downloads use this site's own route, and where their outbound links come from.
[apps/tools/README.md](../apps/tools/README.md) maps the app's other topics.

## Shared template and limits

All active `download` Tools use the shared downloader template and request
path. Dedicated Landers normally use `download-*` slugs and inherit the shared
extension CTA, action-triggered ad gate, modal, and rate limit. The page's
countdown starts when an attempt ends; the server's limit starts at a
successful fetch. The generic `/video-downloader/` route remains the broad
multi-source entry point.

## Where downloads are fetched

Downloads deliberately use this site's own `/api/media-fetch`, not the shared
`https://api.serp.co/download/` that the serp downloader-tools standard names
(owner decision, 2026-10-07, issue #169). What that route does is under
[server routes](execution-paths.md#server-routes), and its request contract
under [request contracts](execution-paths.md#request-contracts).

## Outbound links

Outbound Product links are curated data, never derived from Tool ids or slugs.
Downloader Lander link changes must follow
[the outbound-link policy](agents/downloader-lander-links.md).

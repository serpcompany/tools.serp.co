# Vercel Retirement / Cloudflare Readiness Audit

Historical evidence only.

- Generated: 2026-06-20T03:58:39.005Z at revision
  `64c81f541d8d72dcbf8813283bf6833d9032d1fc`
- Scope: the Vercel, Cloudflare, route, dependency, and telemetry observations
  recorded below
- Limitation: the worktree was dirty and external state is time-dependent;
  GitHub issue #34 and the current Cloudflare runbook own retirement work

## Baseline

- Git branch: main
- Git commit: 05a7841f8400dc7da08c9c5cf90bba2d10907460
- Worktree: Worktree has uncommitted changes; this report is tied to the commit plus local diff.
- Vercel project: tools.serp.co
- Vercel root directory: apps/tools
- Vercel Node version: 22.x
- Cloudflare Worker: tools-serp-co
- Cloudflare main: .open-next/worker.js
- Cloudflare compatibility date: 2024-12-30
- Cloudflare compatibility flags: nodejs_compat, global_fetch_strictly_public

## Route Inventory

- tools.json entries: 2785
- Active tools: 2756
- Unique active tool routes: 2756
- FFmpeg-required active tools: 1525
- Public GET manifest routes, excluding token-gated dashboard: 2839
- App Router page/route/layout source files: 284
- Page files: 267
- Route handler files: 16

| operation | active tools |
| --- | --- |
| audio-editor | 1 |
| bulk | 1 |
| combine | 1 |
| compress | 24 |
| convert | 2424 |
| download | 292 |
| edit | 4 |
| image-editor | 1 |
| video-editor | 1 |
| view | 7 |

## Cloudflare Bindings

| type | name | details |
| --- | --- | --- |
| D1 | SERP_TOOLS_DB | serp-tools-prod; migrations: migrations |
| service | WORKER_SELF_REFERENCE | tools-serp-co |
| assets | ASSETS | .open-next/assets |
| R2 | NEXT_INC_CACHE_R2_BUCKET | tools-serp-co-inc-cache; preview: tools-serp-co-inc-cache-preview |
| observability | Workers Logs | enabled: true; head sampling: 1 |
| placement | Smart Placement | mode: smart |

## Runtime Risk Findings

### Blockers

| route | risk | reason | file |
| --- | --- | --- | --- |
| /api/image-compress | native_image | Native image tooling or binary execution must be proven outside standard Workers. | apps/tools/app/api/image-compress/route.ts |
| /api/image-convert | child_process | Standard Cloudflare Workers cannot execute native child processes. | apps/tools/app/api/image-convert/route.ts |
| /api/image-convert | native_image | Native image tooling or binary execution must be proven outside standard Workers. | apps/tools/app/api/image-convert/route.ts |
| /api/media-fetch | yt_dlp | yt-dlp requires a native executable process. | apps/tools/app/api/media-fetch/route.ts |
| /api/pdf-compress | native_pdf | Ghostscript/qpdf style PDF compression requires native runtime support. | apps/tools/app/api/pdf-compress/route.ts |
| /api/video-convert | child_process | Standard Cloudflare Workers cannot execute native child processes. | apps/tools/app/api/video-convert/route.ts |

### High-Risk Validation Items

| route | risk | reason | file |
| --- | --- | --- | --- |
| /api/image-convert | tmp_fs | Temporary filesystem behavior needs live Worker validation. | apps/tools/app/api/image-convert/route.ts |
| /api/media-fetch | tmp_fs | Temporary filesystem behavior needs live Worker validation. | apps/tools/app/api/media-fetch/route.ts |
| /api/video-convert | tmp_fs | Temporary filesystem behavior needs live Worker validation. | apps/tools/app/api/video-convert/route.ts |

## Environment Inventory

Runtime, deploy, and audit tooling names are listed here. Secret values are intentionally not read or reported.

| env var | references |
| --- | --- |
| ADSENSE_PUBLISHER_ID | apps/tools/app/ads.txt/route.ts |
| BUILD_MODE | apps/tools/lib/capabilities.ts |
| CLOUDFLARE_BASE_URL | apps/tools/scripts/audit-cloudflare-parity.mjs<br>apps/tools/scripts/smoke-cloudflare-api.mjs |
| DATABASE_URL | packages/app-core/src/db/index.ts<br>packages/tool-telemetry/src/d1.test.mjs<br>packages/tool-telemetry/src/server.ts |
| DOWNLOADER_RATE_LIMIT_SECRET | apps/tools/lib/downloader-rate-limit.ts<br>apps/tools/lib/server-action-rate-limit.ts |
| FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY | apps/tools/app/api/media-fetch/route.ts |
| GH_TOKEN | apps/tools/app/api/media-fetch/route.ts |
| GITHUB_TOKEN | apps/tools/app/api/media-fetch/route.ts |
| INTERNAL_DASHBOARD_TOKEN | apps/tools/app/internal/tools/page.tsx<br>apps/tools/scripts/audit-cloudflare-parity.mjs<br>apps/tools/scripts/smoke-cloudflare-api.mjs |
| MEDIA_FETCH_SMOKE_URL | apps/tools/scripts/smoke-cloudflare-api.mjs |
| NEXT_PUBLIC_ADSENSE_CLIENT | apps/tools/app/ads.txt/route.ts<br>apps/tools/components/ToolAds.tsx<br>packages/app-core/src/components/app-layout.tsx |
| NEXT_PUBLIC_ADSENSE_RESPONSIVE | apps/tools/components/ToolAds.tsx |
| NEXT_PUBLIC_ADSENSE_SLOT_INLINE | apps/tools/components/ToolAds.tsx |
| NEXT_PUBLIC_ADSENSE_SLOT_LEFT | apps/tools/components/ToolAds.tsx |
| NEXT_PUBLIC_ADSENSE_SLOT_RAIL | apps/tools/components/ToolAds.tsx |
| NEXT_PUBLIC_ADSENSE_SLOT_RIGHT | apps/tools/components/ToolAds.tsx |
| NEXT_PUBLIC_ADSENSE_TEST_MODE | apps/tools/components/ToolAds.tsx<br>packages/app-core/src/components/app-layout.tsx |
| NEXT_PUBLIC_ASSETS_BASE_URL | apps/tools/lib/convert/video.ts<br>apps/tools/scripts/build-cloudflare.mjs<br>apps/tools/scripts/smoke-cloudflare-api.mjs |
| NEXT_PUBLIC_DOWNLOADER_MEDIA_FETCH_ENDPOINT | apps/tools/lib/media-fetch-endpoint.ts |
| NEXT_PUBLIC_FFMPEG_SINGLE_THREAD | apps/tools/lib/capabilities.ts<br>apps/tools/lib/coep.ts<br>apps/tools/lib/convert/video.ts |
| NEXT_PUBLIC_MEDIA_FETCH_ENDPOINT | apps/tools/lib/media-fetch-endpoint.ts |
| NEXT_PUBLIC_SITE_URL | apps/tools/app/layout.tsx<br>apps/tools/lib/sitemap.ts<br>apps/tools/scripts/build-cloudflare.mjs |
| NEXT_PUBLIC_VIDEO_CONVERSION_PREFER_SERVER | apps/tools/lib/convert/video.ts |
| NODE_ENV | apps/tools/lib/adsense-runtime.ts<br>packages/app-core/dist/components/gtag-manager.js<br>packages/app-core/src/components/app-layout.tsx<br>packages/app-core/src/components/gtag-manager.tsx |
| PORT | apps/tools/scripts/dev.mjs |
| R2_ASSETS_BUCKET | apps/tools/scripts/upload-r2-ffmpeg-assets.mjs |
| SERVER_ACTION_RATE_LIMIT_SECRET | apps/tools/lib/server-action-rate-limit.ts |
| SUPPORTS_VIDEO_CONVERSION | apps/tools/lib/capabilities.ts |
| VERCEL_BASE_URL | apps/tools/scripts/audit-cloudflare-parity.mjs |
| YOUTUBE_DL_HOST | apps/tools/app/api/media-fetch/route.ts |
| YTDLP_BINARY_URL | apps/tools/app/api/media-fetch/route.ts |

Dynamic process.env access also appears in: apps/tools/app/api/media-fetch/route.ts

## Assets

- Vendored public assets scanned: 384
- Assets over Workers Static Assets 25 MiB limit: 2

| asset | size |
| --- | --- |
| public/vendor/ffmpeg-st/ffmpeg-core.wasm | 30.6 MiB |
| public/vendor/ffmpeg/ffmpeg-core.wasm | 31.1 MiB |

## D1 Migrations

| migration | statements |
| --- | --- |
| apps/tools/migrations/0001_tool_telemetry.sql | 4 |

## Verification Commands

| gate | command |
| --- | --- |
| typecheck | tsc --noEmit |
| lint | eslint . --max-warnings 0 |
| cf:build | node scripts/build-cloudflare.mjs |
| d1:migrate:preview | wrangler d1 migrations apply SERP_TOOLS_DB --remote --preview |
| d1:migrate:prod | wrangler d1 migrations apply SERP_TOOLS_DB --remote |
| r2:upload-ffmpeg-assets | node scripts/upload-r2-ffmpeg-assets.mjs |

## Current Retirement Gate

Do not retire Vercel yet. The registry-backed pages and SEO/static routes can be audited for Cloudflare parity, but the native processor API routes remain blocking until they are proven through a retained Node service, Cloudflare Containers, or a Worker-compatible replacement.

## References

- [Cloudflare Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) - Cloudflare lists child_process as partially supported and non-functional.
- [Cloudflare Workers process.env behavior](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/) - process.env is populated from Worker vars/secrets by default only for compatibility dates on or after 2025-04-01, or with the relevant compatibility flag.
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) - Workers Static Assets have a 25 MiB individual file limit.
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) - D1 migrations are versioned SQL files applied through Wrangler.
- [OpenNext Cloudflare caching](https://opennext.js.org/cloudflare/caching) - OpenNext supports R2 incremental cache with optional regional cache for ISR/SSG and data cache.
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) - Workers Logs are enabled through the observability configuration.
- [Cloudflare Smart Placement](https://developers.cloudflare.com/workers/configuration/placement/) - Smart Placement can place a Worker near back-end services based on observed latency.

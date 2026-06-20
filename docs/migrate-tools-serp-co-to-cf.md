# Migrate tools.serp.co To Cloudflare

Status: planning document based on local repo audit.

Source repo:

- Local path: `/Users/devin/dev/repos/tools.serp.co`
- Git remote: `https://github.com/serpcompany/tools.serp.co`
- Current hosting: Vercel
- Current database: Neon/Postgres for telemetry
- Target hosting: Cloudflare Workers for the Next.js app, with a separate plan for native processing APIs

## Executive Summary

`tools.serp.co` is not a simple repeat of the `extensions.serp.co` migration. It is much larger and has runtime features that do not fit directly into standard Cloudflare Workers.

The pages, SEO routes, static assets, telemetry endpoint, and most registry-backed content can move to Cloudflare Workers with OpenNext. The heavy processing APIs need a separate architecture decision because they depend on native binaries and child processes.

Cloudflare Workers support a subset of Node.js APIs via `nodejs_compat`, but `child_process` is currently listed by Cloudflare as partially supported and non-functional. That means routes that spawn `ffmpeg`, `magick`, `exiftool`, `yt-dlp`, or Ghostscript cannot be copied directly into a Worker.

Recommended migration shape:

1. Move the Next.js app shell, static pages, SEO routes, sitemap routes, and telemetry to Cloudflare Workers.
2. Move telemetry Postgres tables to D1.
3. Split native conversion/download processing into a separate service, Cloudflare Containers, or keep it on a Node runtime until replaced.
4. Cut over the public domain only after all critical tool flows pass preview validation.

## Current Repo Facts

Local audit findings:

- Monorepo using pnpm and Turbo.
- Root package name: `serp-tools`.
- App package: `apps/tools`.
- Vercel project root: `apps/tools`.
- Node engine currently: `>=20 <23`.
- Current Vercel project metadata exists in `.vercel`.
- There is a Vercel preview deployment workflow at `.github/workflows/preview.yml`.
- The current workflow uses Vercel secrets:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`
- App route surface:
  - About 283 app pages/routes.
  - About 267 page files.
  - 16 route handlers.
- Registry/content scale:
  - `packages/app-core/src/data/tools.json` has 2,785 entries.
  - 2,756 entries are active.
  - 292 entries are download tools.
  - 1,535 entries require FFmpeg.
- Local repo size is large because of build output, benchmark fixtures, vendored WASM, and tool data.
- Excluding `node_modules`, `.next`, `.vercel`, vendored runtime assets, and benchmark fixtures, the app/package/script/doc surface is still about 1,815 files.

Important security note:

- `.vercel/.env.production.local` exists locally and contains production-style secrets and database credentials.
- The `.vercel` directory is gitignored, so this is not committed in the audited checkout.
- Treat those credentials as sensitive local material.
- Rotate or replace relevant secrets when Cloudflare production is ready.
- Do not copy raw Vercel env dumps into docs, commits, tickets, or logs.

## Current Stack

Application:

- Next.js 15.5.x App Router.
- React 19.
- pnpm workspace.
- Turbo.
- Shared packages:
  - `packages/app-core`
  - `packages/tool-telemetry`
  - `packages/ui`
  - `packages/eslint-config`
  - `packages/typescript-config`

Data:

- Postgres/Neon via `DATABASE_URL`.
- Drizzle schema in `packages/app-core/src/db/schema.ts`.
- `drizzle.config.ts` currently uses PostgreSQL dialect.
- Database access:
  - `packages/app-core/src/db/index.ts`
  - `postgres` driver
  - `drizzle-orm/postgres-js`

Telemetry:

- Client telemetry posts to `/api/telemetry`.
- Server handler calls `recordToolRun`.
- If `DATABASE_URL` is missing, telemetry returns success with `skipped: true`.
- Internal dashboard reads telemetry from database at `apps/tools/app/internal/tools/page.tsx`.

Processing/runtime:

- Browser workers in `apps/tools/workers`.
- Vendored WASM and JS assets under `apps/tools/public/vendor`.
- Server-side native processing APIs:
  - `/api/video-convert`
  - `/api/image-convert`
  - `/api/image-compress`
  - `/api/pdf-compress`
  - `/api/media-fetch`

External services:

- Vercel hosting and preview deployments.
- Neon/Postgres.
- AdSense via public env configuration.
- GitHub token or alternate binary URL for `yt-dlp` fallback.
- Internal dashboard token.
- Rate-limit secrets for downloader/server-action cooldown cookies.

## Current Database Tables

The active schema in `packages/app-core/src/db/schema.ts` defines four tables:

- `tools`
- `tool_content`
- `tool_runs`
- `tool_status`

Important PostgreSQL-specific schema features:

- `pgTable`
- `jsonb`
- `timestamp` with timezone
- `uuid`
- `text().array()`

Migration implication:

- D1 can handle this workload, but the schema must be converted to SQLite/D1 types.
- JSONB fields should become text JSON or SQLite JSON-compatible text fields through Drizzle.
- Postgres arrays should become JSON text arrays or normalized join rows.
- UUID defaults need replacement with application-generated IDs or SQLite-compatible defaults.
- Timestamps need a consistent integer or text representation.

## Worker Compatibility Risks

The following routes are incompatible with a straight Worker-only migration:

### `/api/video-convert`

Uses:

- `node:child_process`
- `spawn`
- `ffmpeg-static`
- temporary filesystem directories

Problem:

- Cloudflare Workers cannot run native child processes.

### `/api/image-convert`

Uses:

- `spawn`
- `ffmpeg`
- `magick`
- `exiftool`
- temporary filesystem files

Problem:

- Native binaries and child processes are not available in standard Workers.

### `/api/media-fetch`

Uses:

- `youtube-dl-exec`
- `yt-dlp` binary
- temp binary download path
- GitHub token or binary URL fallback

Problem:

- `yt-dlp` execution requires a native process.

### `/api/pdf-compress`

Uses:

- `ghostscript-node`
- Ghostscript/qpdf expectations

Problem:

- Ghostscript is native runtime functionality, not a Worker-native API.

### `/api/image-compress`

Uses:

- `sharp`

Problem:

- `sharp` depends on native image libraries. It is usually not viable inside Workers.
- It may need to remain in Node, be replaced with WASM, or be moved to a container service.

## Target Cloudflare Stack

Core app:

- Cloudflare Workers.
- OpenNext Cloudflare adapter.
- `wrangler.jsonc`.
- `nodejs_compat` for compatible Node APIs.
- Cloudflare static assets binding.
- Service binding for OpenNext self-reference.
- Production custom domain: `tools.serp.co`.
- Preview Worker without production custom domain inheritance.

Data:

- Cloudflare D1 for telemetry and registry-backed database tables if still needed at runtime.
- D1 binding name: `SERP_TOOLS_DB`.
- Databases:
  - `serp-tools-prod`
  - `serp-tools-preview`
- Current D1 IDs, telemetry schema, access commands, dashboard path, and cache
  bindings are documented in `docs/knowledge/cloudflare-operations.md`.

Secrets:

- Cloudflare Worker secrets for private values.
- GitHub Actions secrets for deployment:
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN`
- App secrets likely needed:
  - `INTERNAL_DASHBOARD_TOKEN`
  - `SERVER_ACTION_RATE_LIMIT_SECRET`
  - `DOWNLOADER_RATE_LIMIT_SECRET`
  - `GITHUB_TOKEN` or `GH_TOKEN` only if still needed by a non-Worker processor
  - AdSense public env values as appropriate

Processing services:

Choose one before implementation:

1. Cloudflare Worker app plus separate Node service for native processors.
2. Cloudflare Worker app plus Cloudflare Containers for native processors.
3. Worker app only, but disable server-side native processing and rely on browser/WASM flows.
4. Worker app plus queue-backed asynchronous processing service.

Recommendation:

- Do not attempt a single-pass Worker-only migration.
- First deploy the app shell and non-native routes to Cloudflare.
- Keep native processor endpoints on a Node-compatible runtime until a replacement is proven.

## Lessons From devinschumacher.com Migration

These are operational lessons from the `devinschumacher.com` Vercel-to-Cloudflare move that should be applied here before cutover:

- Choose one deployment authority per branch:
  - Cloudflare Worker deploys through GitHub Actions/Wrangler; or
  - Cloudflare dashboard-connected builds; or
  - another documented deploy pipeline.
- Do not keep a Vercel preview workflow and a Cloudflare preview workflow both claiming the same deployment role after the Cloudflare preview path works.
- Verify Cloudflare GitHub integration access before depending on dashboard "Connect to repository" flows. If OAuth/install access is invalid, deploy through GitHub Actions with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- Separate build-time env from runtime Worker secrets:
  - public `NEXT_PUBLIC_*` values needed during the Next/OpenNext build go in the CI/build environment;
  - runtime secrets and bindings belong in Wrangler/Cloudflare Worker envs;
  - do not copy Vercel env dumps wholesale.
- Audit and remove unused CMS/admin/build surfaces before migration. The `devinschumacher.com` migration removed unused TinaCMS infrastructure that was adding build steps, admin assets, API routes, and secrets without powering production content.
- Remove Vercel-specific config, README language, deploy workflows, and env dependencies only after Cloudflare preview and production deploys are validated.
- After deleting routes, handlers, or generated admin assets, regenerate Next/OpenNext artifacts before trusting `tsc`; stale `.next/types` can report deleted routes until a fresh build.
- Confirm the production cutover with response headers (`curl -I https://tools.serp.co/`) before retiring Vercel. Cloudflare custom domain verification/DNS propagation can lag, so keep the rollback path alive until production is visibly served by Cloudflare.

## Migration Plan

### Phase 1: Baseline Audit

- Confirm current production behavior for:
  - homepage
  - top converter pages
  - top downloader pages
  - sitemap XML routes
  - `ads.txt`
  - `/api/telemetry`
  - `/internal/tools`
  - `/api/media-fetch`
  - `/api/video-convert`
  - `/api/image-convert`
  - `/api/image-compress`
  - `/api/pdf-compress`
- Capture current response headers for COOP/COEP routes.
- Confirm which server-side processors are business-critical for launch.
- Confirm whether processor endpoints can remain on a subdomain temporarily.
- Confirm whether `tools` and `tool_content` are truly runtime database tables or mostly seeded/exported data.

### Phase 2: Cloudflare App Shell

- Add `@opennextjs/cloudflare`.
- Add `open-next.config.ts`.
- Add `wrangler.jsonc`.
- Add scripts:
  - `cf:preview`
  - `cf:deploy`
  - `cf:typegen`
  - OpenNext build command.
- Update Node CI target to Node 24.
- Keep app root handling correct for `apps/tools`.
- Ensure asset upload includes:
  - FFmpeg WASM assets used by browser workers.
  - ImageMagick WASM assets used in browser or server-compatible flows.
  - PDF.js assets.
  - HEIF/libheif assets.
- Preserve `trailingSlash: true`.
- Preserve sitemap rewrites:
  - `/sitemap-:page.xml`
  - `/pages-:page.xml`
  - `/tools-:page.xml`
  - `/categories-:page.xml`

### Phase 3: D1 Telemetry Migration

- Convert Drizzle schema from PostgreSQL to SQLite/D1.
- Create a separate D1 migration directory.
- Convert table types:
  - `jsonb` to JSON text.
  - `text[]` to JSON text or normalized rows.
  - UUIDs to application-generated text IDs.
  - timestamps to integer or text timestamps.
- Add D1 runtime DB client.
- Keep graceful no-database behavior for local development if desired.
- Build migration commands:
  - local
  - preview
  - production
- Build data import/export path through project tooling, not direct database shells.
- Add dry-run import and count checks.

### Phase 4: Native Processor Decision

Pick and implement one path:

#### Option A: Keep Native Processors On Node Temporarily

- Deploy Cloudflare Worker for pages and lightweight APIs.
- Keep native endpoints on existing Vercel project or a new Node service.
- Proxy selected API routes from Worker to the processor service.
- Cut over public traffic only after proxy behavior is validated.
- Retire Vercel later after processors are replaced.

Pros:

- Fastest public Cloudflare migration.
- Lowest immediate risk to conversion/download features.

Cons:

- Vercel is not fully retired.
- More routing complexity.

#### Option B: Cloudflare Containers

- Package native processors with required binaries.
- Route heavy APIs to container-backed service.
- Keep the main Next app on Workers.

Pros:

- Cloudflare stack end-state.
- Supports native binaries.

Cons:

- More infrastructure work than the `extensions.serp.co` migration.
- Requires separate operational validation.

#### Option C: Browser/WASM Only

- Disable server-native processors.
- Use existing browser workers and WASM where feature coverage is acceptable.
- Hide or degrade unsupported server-only tools.

Pros:

- Pure Worker deployment.

Cons:

- Likely breaks or downgrades some tools.
- Must be validated against all high-traffic tools.

### Phase 5: GitHub Actions

- Replace Vercel preview workflow with Cloudflare preview deployment.
- Add CI:
  - pnpm install.
  - lint.
  - typecheck for `apps/tools`.
  - tool validators.
  - Next build.
  - OpenNext build.
  - Wrangler dry-run for preview and production.
- Add production deployment on `main`.
- Add D1 migration step before production deploy if D1 is in use.
- Keep manual workflow for D1 telemetry sync/backfill if needed.
- Keep Vercel preview deployment disabled or removed once Cloudflare preview deployment is the source of truth.
- Include only build-time public env values in GitHub Actions; install private runtime values as Cloudflare Worker secrets/bindings.
- Add a post-deploy smoke step against the preview Worker URL before attaching or changing custom domains.

### Phase 6: Preview Validation

Validate preview Worker:

- `/`
- representative converter pages.
- representative downloader pages.
- `/categories/` and category pages.
- `/sitemap-index.xml`.
- `/pages-index.xml`.
- `/tools-index.xml`.
- `/categories-index.xml`.
- paginated sitemap routes.
- `ads.txt`.
- COOP/COEP headers on FFmpeg/transcription routes.
- browser worker loading.
- WASM asset loading.
- telemetry endpoint.
- internal dashboard behind token.
- native processing routes via the selected architecture.

Required browser checks:

- File upload flow.
- Browser conversion worker flow.
- Downloader flow.
- Transcription flow.
- Large static asset loading.
- Mobile layout on high-traffic pages.

### Phase 7: Production Cutover

- Deploy production Worker.
- Validate workers.dev or preview URL first.
- Attach `tools.serp.co` custom domain only after production Worker passes smoke checks.
- Delete or replace the old Vercel DNS record in Cloudflare DNS.
- Confirm Cloudflare response headers after cutover.
- Validate:
  - homepage.
  - high-traffic tool pages.
  - server processor endpoints.
  - sitemap routes.
  - robots.
  - ads.txt.
  - static assets.
  - no unintended canonical URL changes.

### Phase 8: Vercel And Neon Retirement

Only after production Cloudflare traffic is stable:

- Remove Vercel domain assignment.
- Disable Vercel Git deploy hooks.
- Remove `.github/workflows/preview.yml` or replace with Cloudflare.
- Remove Vercel env dependencies.
- Remove Vercel-specific config/docs and any unused admin/CMS build outputs that are not used by the Cloudflare runtime.
- Remove Neon/Postgres only after D1 telemetry parity is verified.
- Rotate credentials found in local Vercel env material.
- Remove Postgres dependencies only after no retained code imports them:
  - `postgres`
  - `drizzle-orm/postgres-js`
- Keep any separate native processor service until replaced.

## Validation Checklist

Static checks:

- `pnpm lint`
- `pnpm lint:tools`
- `pnpm lint:links`
- `pnpm -C apps/tools typecheck`
- `pnpm build`
- OpenNext build.
- Wrangler dry-run for preview and production.

Data checks:

- D1 table counts:
  - `tools`
  - `tool_content`
  - `tool_runs`
  - `tool_status`
- Telemetry POST writes a row when D1 is configured.
- Telemetry POST skips cleanly when D1 is unavailable in local/dev.
- Internal dashboard reads D1 status rows.

Runtime checks:

- Worker routes render correctly.
- XML routes return XML content.
- Browser workers load from public paths.
- WASM assets return correct content.
- COOP/COEP headers are preserved.
- Native processor endpoints work through the chosen non-Worker path.

## Rollback

Before removing Vercel:

- Rollback is DNS back to Vercel.
- Keep Neon online until D1 parity and telemetry acceptance are confirmed.
- Keep Vercel project active until native processor endpoints have a confirmed replacement.

After Vercel removal:

- Rollback requires redeploying a prior commit or restoring a Node/Vercel processor service.
- DNS can be moved back only if the old project/service still exists.

## Open Decisions

- Should native processors remain on Vercel temporarily, move to Cloudflare Containers, or be replaced by browser/WASM-only flows?
- Is telemetry important enough to block launch, or can it temporarily skip writes as it does today when `DATABASE_URL` is missing?
- Are `tools` and `tool_content` runtime DB tables, or should `tools.json` remain the source of truth?
- Which routes are critical for day-one cutover?
- Should `tools.serp.co` be split into:
  - `tools.serp.co` on Workers.
  - `api.tools.serp.co` or `processors.tools.serp.co` on a Node/container runtime?

## Recommended Next Step

Do not start with code changes. First make the processor architecture decision.

Recommended path:

1. Migrate telemetry schema to D1 in isolation.
2. Build the OpenNext Worker shell.
3. Keep native processors on a Node runtime behind proxied routes.
4. Validate the full site on preview.
5. Cut over DNS.
6. Replace the Node processor service later with Cloudflare Containers or Worker-compatible WASM implementations.

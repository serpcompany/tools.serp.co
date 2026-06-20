# Cloudflare Production Cutover - 2026-06-20

## Status

Cutover completed after the existing Vercel DNS record was removed or replaced and `pnpm -C apps/tools cf:deploy` was rerun.

`tools.serp.co` is now served by the Cloudflare Worker `tools-serp-co`. Keep Vercel available as rollback until the 72-hour observation window passes.

## Pre-Cutover Gates

- Initial worktree state: clean.
- `pnpm -C apps/tools typecheck`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm -C apps/tools lint`: passed.
- `pnpm -C apps/tools cf:build`: passed.
- Workers.dev API smoke against `https://tools-serp-co.serpcompany.workers.dev`: 13 passed, 4 failed, 1 skipped.
  - Failed native/API checks: `/api/image-compress?format=svg`, `/api/image-convert?from=png&to=jpg`, `/api/video-convert?from=mp4&to=mp3`, `/api/pdf-compress`.
  - This matches the accepted native/process-spawn observation risk in the cutover plan.
- Vercel vs Cloudflare parity crawl:
  - Routes checked: 5,667.
  - Critical findings: 0.
  - High findings: 0.
  - Medium findings: 3,116.
  - Finding types: `medium:cache_control_mismatch` only.
  - Report: `docs/audits/cloudflare-worker-full-route-crawl.md`.

## Config Change

Added the production custom-domain route to `apps/tools/wrangler.jsonc`:

```json
"routes": [
  {
    "pattern": "tools.serp.co",
    "custom_domain": true
  }
]
```

Existing bindings and settings were left unchanged.

## Initial Deploy Result

Command:

```bash
pnpm -C apps/tools cf:deploy
```

Worker upload succeeded and created deployment/version:

- Version ID: `b1af54c9-f5fa-4c7c-a1b1-d248aa7c4b2c`
- Created: `2026-06-20T04:52:00.805Z`
- Worker URL trigger deployed: `https://tools-serp-co.serpcompany.workers.dev`

Wrangler binding summary printed:

- `SERP_TOOLS_DB`: D1 database `69ab9290-579f-4537-96a0-7d0dc3bede2f`
- `NEXT_INC_CACHE_R2_BUCKET`: R2 bucket `tools-serp-co-inc-cache`
- `WORKER_SELF_REFERENCE`: Worker `tools-serp-co`
- `ASSETS`: Workers Static Assets
- `NEXT_PUBLIC_ASSETS_BASE_URL`: `https://assets.tools.serp.co`
- `NEXT_PUBLIC_SITE_URL`: `https://tools.serp.co`

The custom-domain trigger failed:

```text
Some triggers failed to deploy for tools-serp-co:
- A request to the Cloudflare API (/accounts/cec5f04e1d18bcc65f2be0aefb04f059/workers/scripts/tools-serp-co/domains/records) failed.
```

Wrangler log detail showed the failing request returned `409 Conflict`.

## Successful Deploy Result

After the DNS conflict was resolved, rerunning:

```bash
pnpm -C apps/tools cf:deploy
```

succeeded and attached the production hostname:

- Worker URL trigger deployed: `https://tools-serp-co.serpcompany.workers.dev`
- Custom domain deployed: `tools.serp.co`
- Current Version ID: `14ab28f7-6ea0-4a4f-ac27-fee0415f44d2`

Wrangler binding summary printed:

- `SERP_TOOLS_DB`: D1 database `69ab9290-579f-4537-96a0-7d0dc3bede2f`
- `NEXT_INC_CACHE_R2_BUCKET`: R2 bucket `tools-serp-co-inc-cache`
- `WORKER_SELF_REFERENCE`: Worker `tools-serp-co`
- `ASSETS`: Workers Static Assets
- `NEXT_PUBLIC_ASSETS_BASE_URL`: `https://assets.tools.serp.co`
- `NEXT_PUBLIC_SITE_URL`: `https://tools.serp.co`

## Production Header Evidence

Header checks after the successful deploy:

```text
/                   200 server=cloudflare x-opennext=1 x-vercel-id=-
/category/download/ 200 server=cloudflare x-opennext=1 x-vercel-id=-
/sitemap-index.xml  200 server=cloudflare x-opennext=1 x-vercel-id=-
/ads.txt            200 server=cloudflare x-opennext=1 x-vercel-id=-
```

## Production API Smoke

Production smoke against `https://tools.serp.co`:

- Passed: 13.
- Failed: 4.
- Skipped: 1.
- Telemetry synthetic started event: passed with `{"ok":true}`.
- Failed native/API checks:
  - `/api/image-compress?format=svg`
  - `/api/image-convert?from=png&to=jpg`
  - `/api/video-convert?from=mp4&to=mp3`
  - `/api/pdf-compress`

These failures match the accepted native/process-spawn observation risk from the cutover plan.

## Previous DNS And Header Evidence

Before the DNS conflict was resolved, public DNS pointed at Vercel:

```text
tools.serp.co CNAME a41fd49d9b7f4f62.vercel-dns-016.com.
tools.serp.co A     216.150.16.193
tools.serp.co A     216.150.1.193
```

Production hostname headers also showed Vercel during the failed first attempt:

```text
server: Vercel
x-vercel-id: hnd1::pj4r2-1781931239952-7752e840218d
```

Workers.dev headers showed the Cloudflare Worker was live before the production hostname was attached:

```text
server: cloudflare
x-opennext: 1
cf-placement: local-NRT
```

## Permission Blocker

Wrangler is authenticated as `cloudflare@serp.co` on account `SERP` (`cec5f04e1d18bcc65f2be0aefb04f059`).

The OAuth token can deploy Workers and Worker routes, but a direct Cloudflare API read of DNS records failed:

```text
GET /zones/dd5e64cf115a1aa74c1be503374ead13/dns_records?name=tools.serp.co&per_page=100 failed 403: Authentication error
```

This session could not remove or replace the current Vercel DNS record at the time. The blocker was resolved outside that failed attempt before the successful deploy above.

## Required Next Action

1. Verify Cloudflare dashboard builds for Worker `tools-serp-co` in the dashboard:
   - Repository: `serpcompany/tools.serp.co`
   - Production branch: `main`
   - Install command: `pnpm install --frozen-lockfile`
   - Build command: `pnpm -C apps/tools cf:build`
   - Deploy command: `pnpm -C apps/tools exec wrangler deploy`
   - Builds for non-production branches: disabled unless a separate preview Worker strategy is added.
2. Commit and push the Cloudflare route config and audit notes.
3. Observe production for 72 hours before retiring Vercel.
4. Roll back by restoring Vercel DNS/routing if production shows route failures, broken native API flows, telemetry failures, or missing critical assets.

Automation note: the current Wrangler OAuth token can read the Worker tag
`4e38de528c2f4e2e8abfb7f4468e180e`, but Cloudflare's Workers Builds triggers
API returned `403 Authentication error`, so the dashboard build trigger settings
were not machine-verifiable from this session.

# Cloudflare Operations

This is the runbook for the `tools.serp.co` Cloudflare Worker, D1 telemetry
database, and cache bindings.

## Cloudflare Account

- Cloudflare account: `SERP`
- Account ID: `cec5f04e1d18bcc65f2be0aefb04f059`
- Config: `apps/tools/wrangler.jsonc` is the only Wrangler config. Its top level
  is local-only and never deployed; every deploy and remote command passes
  `--env staging` or `--env production`.

## Environments

| Environment | Worker                  | Canonical host                  | D1                   | R2 incremental cache              |
| ----------- | ----------------------- | ------------------------------- | -------------------- | --------------------------------- |
| Local       | (not deployed)          | `http://localhost:8787`         | `serp-tools-local`   | `tools-serp-co-inc-cache-local`   |
| Staging     | `tools-serp-co-staging` | `https://staging.tools.serp.co` | `serp-tools-preview` | `tools-serp-co-inc-cache-preview` |
| Production  | `tools-serp-co`         | `https://tools.serp.co`         | `serp-tools-prod`    | `tools-serp-co-inc-cache`         |

Staging reuses the former preview D1 database and R2 bucket. Both deployed
environments keep their `*.workers.dev` URL (`workers_dev: true`) for CI and
turn off preview URLs (`preview_urls: false`).

`NEXT_PUBLIC_SITE_ENV` (`local`, `staging` or `production`) is set by each
`cf:build:*` script and in each environment's `vars`. Next.js inlines it at
build time when it is set, so the build command decides it; a test keeps the
build scripts, `vars` and routes in agreement. A Workers Builds build fails
unless it is `staging` or `production`, and a build of `main` must be
`production`. Anything other than `production` is non-production
(`apps/tools/lib/site-environment.ts`):

- Every page sends `X-Robots-Tag: noindex, nofollow`, and `robots.txt`
  disallows everything and lists no sitemap.
- Google Tag Manager and AdSense don't load. AdSense test mode
  (`NEXT_PUBLIC_ADSENSE_TEST_MODE=true`) still enables test ads in any build.
- In staging and production, any host other than the canonical one, such as
  `*.workers.dev`, gets a 308 to the canonical host. Requests with the
  `x-tools-serp-smoke-test` header skip the redirect so CI can test through the
  `*.workers.dev` URL. Local runs never redirect.

These rules apply to responses the Worker renders. Files in
`apps/tools/public` are served by Workers Static Assets before the Worker runs,
so they get neither the redirect nor the header; `public/_headers` marks
`/vendor/*` (which includes the pdf.js viewer HTML) `noindex` everywhere.

After a deploy, check the environment rules: robots, `X-Robots-Tag`, and GTM
and AdSense present only in production (the check assumes AdSense test mode is
off). Add `--platform-url` with the Worker's
`*.workers.dev` URL to check the redirect too; it retries for 30 s while the
new version rolls out.

```bash
pnpm -C apps/tools audit:cf:api-smoke --base-url https://staging.tools.serp.co --expect-env staging
```

The **Deploy** workflow (`.github/workflows/deploy.yml`) deploys each
environment from its branch: a push to `staging` deploys Staging, and a push to
`main`, which only changes by promotion, deploys Production.

- Each run builds (`cf:build:<env>`), applies that environment's D1 migrations
  (`db:migrate:<env>`), runs `wrangler deploy --env <env>`, then the
  environment smoke check through the Worker's `*.workers.dev` host.
- Staging also runs the browser smoke test ([browser-smoke.md](browser-smoke.md)).
  Production doesn't, because the test records real tool runs.
- Only the migrate and deploy steps see the `CLOUDFLARE_API_TOKEN` repository
  secret (an account-owned SERP token for Workers, D1 and the `serp.co` zone's
  Workers routes).
- A run for a commit that is no longer its branch's head refuses to deploy.

Until the first promotion has deployed Production through this workflow,
Cloudflare Workers Builds also deploys every push to `main`. It is disconnected
after that (#188).

Promote only a commit whose staging Deploy run passed:

```bash
git fetch origin && gh run list --workflow deploy.yml --branch staging --commit "$(git rev-parse origin/staging)"
git push origin origin/staging:main
```

The promotion push needs the owner's bypass on the `main` ruleset (#188). If a
production deploy turns out bad, roll back with
`pnpm -C apps/tools exec wrangler rollback --env production`. Rollback doesn't
undo migrations, so a migration must keep working with the previous version of
the code. A hotfix is a PR into `main`; merge `main` back into `staging` right
after.

```bash
pnpm -C apps/tools cf:preview                 # local build + wrangler dev (top-level config)
pnpm -C apps/tools cf:preview:staging         # production runtime with staging config
pnpm -C apps/tools cf:preview:production      # production runtime with production config
pnpm -C apps/tools deploy:staging
pnpm -C apps/tools deploy:production          # normally run by the Deploy workflow
```

Secrets are per Worker: `wrangler secret put <NAME> --env staging` or
`--env production`.

Do not commit Cloudflare API tokens, dashboard tokens, legacy platform env
dumps, or raw database credentials. Secrets belong in Cloudflare Worker secrets
or the deployment system.

## D1 Telemetry Database

The app writes tool-run telemetry to Cloudflare D1 through the Worker binding
`SERP_TOOLS_DB`. The schema, how to change it, and the `/api/telemetry` write
contract are in [d1-telemetry.md](d1-telemetry.md).

## Access Paths

Migration commands name their environment. Apply to staging and verify before
production. Never use `--preview`: it targets a binding's
`preview_database_id`, not the staging environment.

```bash
pnpm -C apps/tools db:migrations:list:local
pnpm -C apps/tools db:migrate:local
pnpm -C apps/tools db:migrations:list:staging
pnpm -C apps/tools db:migrate:staging
pnpm -C apps/tools db:migrations:list:production
pnpm -C apps/tools db:migrate:production
```

Per repo policy, do not run ad-hoc SQL or database shell commands against local,
preview, staging, or production databases unless the user explicitly approves
that operation. Prefer the project migration scripts above.

Dashboard access:

- Route: `/internal/tools`
- Auth: HTTP Basic Auth (`apps/tools/middleware.ts`). Any username; the
  password must match the Worker secret `INTERNAL_DASHBOARD_TOKEN`. If the
  secret is unset, every request gets `401`.
- Data source: the `SERP_TOOLS_DB` D1 binding only. A missing binding is shown as
  an error instead of falling back to another database.

## Cache And Optimization Bindings

OpenNext uses an R2 incremental cache with Cloudflare regional cache in
`long-lived` mode.

R2 buckets:

- Worker binding: `NEXT_INC_CACHE_R2_BUCKET`, one bucket per environment (see
  Environments).

Worker-level settings in `apps/tools/wrangler.jsonc`:

- Workers Static Assets binding: `ASSETS`
- Worker self-reference service binding: `WORKER_SELF_REFERENCE`
- Workers Logs observability: enabled with `head_sampling_rate: 1`
- Smart Placement: enabled with `mode: smart`

Static Next build assets use `apps/tools/public/_headers`:

```text
/_next/static/*
  Cache-Control: public,max-age=31536000,immutable
```

The external FFmpeg/WASM asset host remains
`https://assets.tools.serp.co`, configured through
`NEXT_PUBLIC_ASSETS_BASE_URL`.

## Production and retirement boundary

Production was cut over to Cloudflare on 2026-06-20. The dated cutover and
route-parity evidence is archived under `.archive/audits`; it is not a current
deployment procedure.

Repository runtime and CI paths are Cloudflare-only. The legacy Postgres client,
Postgres Drizzle configuration, Vercel preview workflow, and Vercel comparison
runners have been removed. External account retirement remains owner-controlled
under GitHub issue #34; repository cleanup is not evidence that remote projects,
domains, integrations, credentials, or databases have been deleted.

Native-binary APIs using FFmpeg, ImageMagick, Ghostscript, `yt-dlp`, Sharp, or
child processes remain a separate architecture concern. GitHub issue #67 owns
explicit execution-profile and engine provenance; any replacement runtime also
requires its own issue or accepted decision. Local Node.js success is not proof
of Cloudflare Worker compatibility.

### Owner-controlled legacy platform sequence

The human owner must complete these operations with authorized provider access.
Do not store production rows, credentials, or exports in the repository or in
structured run artifacts.

1. Create a protected export or snapshot of the legacy telemetry database in an
   owner-controlled location outside the repository. Record only sanitized
   provenance such as provider snapshot id, UTC time, cutoff, row count, and a
   checksum in a dated audit.
2. Perform a read-only reconciliation against production D1. Compare the
   coverage window, counts, stable run ids at the cutoff, and documented
   acceptable discrepancies. A repository test cannot substitute for this
   production-data verification.
3. After reconciliation is accepted, retire the bounded importer together with
   its migration-source convention under issue #61.
4. Disable the legacy Git integration, detach obsolete domains/rollback paths,
   and remove the legacy project and database only after recovery and rollback
   needs are signed off.
5. Remove or rotate legacy provider credentials. Inspect ignored `.env*` files
   for the retired database variable and remove the ignored `.vercel/` metadata
   directory manually. Never commit, print, or blanket-delete those files.

Before a human-controlled Cloudflare deployment, run the deterministic local
checks and the production-faithful build. Deployed API canaries are separate
live-system operations and must name their target:

```bash
pnpm -C apps/tools lint
pnpm -C apps/tools typecheck
pnpm -C apps/tools cf:build
pnpm -C apps/tools audit:cf:api-smoke -- --base-url <deployed-preview-url> --no-fail
```

The browser smoke test can also run against a deployment; see
[browser-smoke.md](browser-smoke.md).

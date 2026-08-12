# Cloudflare Operations

This is the runbook for the `tools.serp.co` Cloudflare Worker, D1 telemetry
database, and cache bindings.

## Cloudflare Account

- Cloudflare account: `SERP`
- Account ID: `cec5f04e1d18bcc65f2be0aefb04f059`
- Worker name: `tools-serp-co`
- Worker preview URL: `https://tools-serp-co.serpcompany.workers.dev`
- Production host after cutover: `https://tools.serp.co`
- Runtime config source of truth: `apps/tools/wrangler.jsonc`

Wayfinder acceptance uses the isolated named environment
`wayfinder-preview`:

- Worker name: `tools-serp-co-wayfinder-preview`
- Origin: `https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev`
- Routes: none; workers.dev only
- D1 database ID: `69ab9290-579f-4537-96a0-7d0dc3bede2f`
- R2 cache bucket: `tools-serp-co-inc-cache-preview`
- Self-reference service: `tools-serp-co-wayfinder-preview`

Wrangler environment variables and bindings are non-inheritable, while routes
are inheritable. The named environment therefore restates all bindings and
uses an explicit empty route list so it cannot receive the production custom
domain.

Do not commit Cloudflare API tokens, dashboard tokens, legacy platform env
dumps, or raw database credentials. Secrets belong in Cloudflare Worker secrets
or the deployment system.

## D1 Telemetry Database

The app writes tool-run telemetry to Cloudflare D1 through the Worker binding
`SERP_TOOLS_DB`.

Production binding:

- Binding: `SERP_TOOLS_DB`
- Database name: `serp-tools-prod`
- Database ID: `da3d6222-cf0f-41fd-a8fb-4dc3e7d890db`
- Migration directory: `apps/tools/migrations`

Preview binding:

- Binding: `SERP_TOOLS_DB`
- Preview database ID: `69ab9290-579f-4537-96a0-7d0dc3bede2f`
- Migration directory: `apps/tools/migrations`

Deploy-output note: with Wrangler `4.103.0`, the binding summary printed by
`wrangler deploy` and `wrangler deploy --dry-run` shows `preview_database_id`
when that field exists. The project config still sets the production deploy
database through `database_id`; use the explicit migration commands below to
target preview versus production.

The D1 schema is intentionally narrower than the legacy Postgres schema. D1
currently stores only telemetry tables needed by `/api/telemetry` and the
internal tools dashboard.

## Tool Runs Schema

`tool_runs`

| Column         | Type      | Null | Notes                                             |
| -------------- | --------- | ---- | ------------------------------------------------- |
| `id`           | `TEXT`    | no   | Primary key. This is the telemetry `runId`.       |
| `tool_id`      | `TEXT`    | no   | Tool registry id.                                 |
| `status`       | `TEXT`    | no   | One of `started`, `succeeded`, or `failed`.       |
| `started_at`   | `TEXT`    | no   | ISO timestamp text.                               |
| `duration_ms`  | `INTEGER` | yes  | Completed run duration.                           |
| `input_bytes`  | `INTEGER` | yes  | Input payload size when known.                    |
| `output_bytes` | `INTEGER` | yes  | Output payload size when known.                   |
| `error_code`   | `TEXT`    | yes  | Failure classifier.                               |
| `metadata`     | `TEXT`    | yes  | JSON text; validated with `json_valid(metadata)`. |

Indexes:

- `idx_tool_runs_tool_id_started_at` on `(tool_id, started_at)`
- `idx_tool_runs_status_started_at` on `(status, started_at)`

`tool_status`

| Column                 | Type      | Null | Notes                                            |
| ---------------------- | --------- | ---- | ------------------------------------------------ |
| `tool_id`              | `TEXT`    | no   | Primary key.                                     |
| `status`               | `TEXT`    | no   | `unknown`, `live`, `degraded`, or `broken`.      |
| `last_run_at`          | `TEXT`    | yes  | Latest run timestamp.                            |
| `failure_rate_24h`     | `REAL`    | yes  | Failed completed runs divided by completed runs. |
| `median_duration_ms`   | `INTEGER` | yes  | Median duration over the last 24 hours.          |
| `median_reduction_pct` | `REAL`    | yes  | Median compression/reduction percentage.         |
| `updated_at`           | `TEXT`    | no   | ISO timestamp text.                              |

The migration that creates these tables is
`apps/tools/migrations/0001_tool_telemetry.sql`.

## Telemetry Write Contract

Clients POST JSON to `/api/telemetry`.

Required fields:

- `runId`
- `toolId`
- `event`
- `startedAt`

Optional fields:

- `durationMs`
- `inputBytes`
- `outputBytes`
- `errorCode`
- `metadata`

Runtime status mapping:

- `tool_run_started` becomes `started`
- `tool_run_succeeded` becomes `succeeded`
- any other valid tool-run event becomes `failed`

`apps/tools/app/api/telemetry/route.ts` enriches metadata with request IP and
user agent when available, then calls `recordToolRun`.
`apps/tools/lib/cloudflare-d1.ts` reads `SERP_TOOLS_DB` from the OpenNext
Cloudflare context. `packages/tool-telemetry/src/d1.ts` owns D1 inserts,
upserts, dashboard summaries, and status recomputation.

Telemetry is D1 only. If the binding is unavailable, the endpoint returns HTTP
503 instead of discarding the event or writing to a compatibility database.

## Access Paths

Supported project commands:

```bash
pnpm -C apps/tools migrate:d1:preview:remote
pnpm -C apps/tools migrate:d1:production:remote
pnpm -C apps/tools import:d1:preview:remote -- --source <absolute-protected-path>
pnpm -C apps/tools import:d1:production:remote -- --source <absolute-protected-path>
```

Migration status through Wrangler:

```bash
pnpm -C apps/tools exec wrangler d1 migrations list SERP_TOOLS_DB --remote --preview
pnpm -C apps/tools exec wrangler d1 migrations list SERP_TOOLS_DB --remote
```

The bounded reconciliation importer requires
`--source <absolute-protected-path>`. The path must resolve outside the
repository and name JSON or CSV. The importer never prints or retains the
source filename. Production exports remain outside the repository and under
human control. Retire the importer after the snapshot and D1 reconciliation in
issue #34 are accepted.

Per repo policy, do not run ad-hoc SQL or database shell commands against local,
preview, staging, or production databases unless the user explicitly approves
that operation. Prefer the project migration and import scripts above.

Dashboard access:

- Route: `/internal/tools`
- Environment: the source-backed Tool Factory table is enabled only in the
  named `wayfinder-preview` environment. Production remains disabled.
- Auth: Cloudflare Access protects `/internal/tools*` for an explicitly
  approved owner email. The application also verifies the signed Access JWT,
  its team issuer, application audience, and exact email claim before rendering.
- Runtime bindings: configure `TOOLS_SERP_CLOUDFLARE_ACCESS_TEAM_DOMAIN`,
  `TOOLS_SERP_CLOUDFLARE_ACCESS_AUD`, and
  `TOOLS_SERP_TOOL_FACTORY_ALLOWED_EMAIL` outside the repository. Do not put
  the approved email or Access credentials in source, logs, or artifacts.
- Access setup (human-authorized mutation): create one Cloudflare Access
  self-hosted application for the Wayfinder workers.dev hostname with path
  `/internal/tools*`; add one Allow policy containing the exact approved owner
  email and no broad Everyone rule. Copy the application AUD and team domain.
  Store all three runtime bindings with `wrangler secret put <NAME> --env
  wayfinder-preview`, entering each value through stdin. The deploy wrapper
  checks that all names exist and refuses deployment when any are absent.
- Display: the page visibly identifies `DEV/STAGING` and the full deployed
  revision. Treat that pair as the boundary for any screenshot or browser
  evidence.
- Data source: the current table joins Catalog, processor, provenance,
  controlled-verification, and revision-local coverage facts. Runtime
  observations remain a separate evidence dimension and are not inferred from
  support registration.

Hosted table verification uses an authenticated Access session cookie supplied
only through the environment:

```bash
TOOL_FACTORY_CF_AUTHORIZATION='<temporary Access cookie>' \
  pnpm -C apps/tools check:tool-factory -- \
  --base-url https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev \
  --environment DEV/STAGING \
  --revision <full-deployed-commit> \
  --screenshot <ignored-artifact-path.png>
```

Never put the cookie in an argument, source file, screenshot, or retained
artifact. The check exercises search, support filtering, column visibility,
pagination, and a Tool detail drawer while asserting the displayed environment
and revision.

## Cache And Optimization Bindings

OpenNext uses an R2 incremental cache with Cloudflare regional cache in
`long-lived` mode.

R2 buckets:

- Production incremental cache: `tools-serp-co-inc-cache`
- Preview incremental cache: `tools-serp-co-inc-cache-preview`
- Worker binding: `NEXT_INC_CACHE_R2_BUCKET`

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
route-parity evidence is indexed under `docs/audits`; it is not a current
deployment procedure.

Repository runtime and CI paths are Cloudflare-only. The legacy Postgres client,
Drizzle schema/configuration, Vercel preview workflow, and Vercel comparison
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
pnpm prepare:cloudflare:wayfinder-preview -- --revision <40-character-commit>
pnpm canary:cloudflare:deployed -- \
  --environment preview \
  --base-url <deployed-preview-origin> \
  --revision <40-character-deployed-commit>
```

The canary performs safe reads by default. Telemetry writes and native API
checks require `--allow-telemetry-write` and `--include-native`, respectively.
Every run records sanitized structured evidence under `.artifacts/runs`.

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

The schema is defined in Drizzle at `packages/tool-telemetry/src/schema.ts`.
To change it, edit the schema, run `pnpm -C apps/tools db:generate`, and commit
the new file in `apps/tools/migrations` with its `meta/` snapshot. The
`d1-migrations` test fails if the schema and migrations disagree. Never use
`drizzle-kit push` against shared databases.

The baseline `0000_tool_telemetry.sql` replaced the hand-written
`0001_tool_telemetry.sql`. It uses `IF NOT EXISTS`, so applying it to the
existing production and preview databases is a no-op; their migration ledgers
will list both names.

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
pnpm -C apps/tools d1:migrate:preview
pnpm -C apps/tools d1:migrate:prod
pnpm -C apps/tools d1:import:preview
pnpm -C apps/tools d1:import:prod
```

Migration status through Wrangler:

```bash
pnpm -C apps/tools exec wrangler d1 migrations list SERP_TOOLS_DB --remote --preview
pnpm -C apps/tools exec wrangler d1 migrations list SERP_TOOLS_DB --remote
```

The legacy reconciliation importer accepts an explicit source with
`--source <protected-path>`. Its repository `tmp/` defaults are temporary
compatibility behavior tracked for retirement by GitHub issues #34 and #61;
do not treat that directory as durable artifact storage. Production exports
must remain outside the repository and under human control.

Per repo policy, do not run ad-hoc SQL or database shell commands against local,
preview, staging, or production databases unless the user explicitly approves
that operation. Prefer the project migration and import scripts above.

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

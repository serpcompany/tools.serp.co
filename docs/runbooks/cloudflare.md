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

Production deploys come from Cloudflare Workers Builds on every push to `main`
(only `main` builds). Its settings must be: root directory `/`, build command
`pnpm -C apps/tools cf:build:production`, deploy command
`pnpm -C apps/tools exec wrangler deploy --env production`. D1 migrations are
not applied by the build; run `db:migrate:production` before merging code that
needs them.

```bash
pnpm -C apps/tools cf:preview                 # local build + wrangler dev (top-level config)
pnpm -C apps/tools cf:preview:staging         # production runtime with staging config
pnpm -C apps/tools cf:preview:production      # production runtime with production config
pnpm -C apps/tools deploy:staging
pnpm -C apps/tools deploy:production          # normally run by Workers Builds
```

Secrets are per Worker: `wrangler secret put <NAME> --env staging` or
`--env production`.

Do not commit Cloudflare API tokens, dashboard tokens, legacy platform env
dumps, or raw database credentials. Secrets belong in Cloudflare Worker secrets
or the deployment system.

## D1 Telemetry Database

The app writes tool-run telemetry to Cloudflare D1 through the Worker binding
`SERP_TOOLS_DB`.

Every environment uses the same binding name, Drizzle schema, migration
directory (`apps/tools/migrations`) and `d1_migrations` ledger, with its own
database (see Environments).

- Production: `serp-tools-prod` (`da3d6222-cf0f-41fd-a8fb-4dc3e7d890db`)
- Staging: `serp-tools-preview` (`69ab9290-579f-4537-96a0-7d0dc3bede2f`)

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

Clients POST JSON to `/api/telemetry`. Bodies over 16k characters get `413`.
`packages/tool-telemetry/src/validate.ts` checks and caps every field before it
reaches SQL:

| Field                                     | Rule                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `event`                                   | Required. `tool_run_started`, `tool_run_succeeded` or `tool_run_failed`. |
| `runId`, `toolId`                         | Required. Letters, digits, `_` and `-`, up to 80 characters.             |
| `startedAt`                               | Required. A date within 24 hours of the server clock.                    |
| `durationMs`, `inputBytes`, `outputBytes` | Optional. Non-negative numbers up to 10¹².                               |
| `errorCode`                               | Optional. Letters, digits and `_.:-`, up to 64 characters.               |
| `from`, `to`                              | Optional and not stored. Values that don't fit are dropped.              |
| `metadata`                                | Optional. Flat object, at most 20 keys and 4 KB. See below.              |

Metadata strings are cut to 256 characters, nested values are stored as JSON
strings, and keys that aren't simple names are dropped.

Invalid events get `400` with a stable code in `error` (`invalid_json`,
`invalid_event`, `invalid_run_id`, and so on). D1 failures return
`d1_write_failed` and log only the error class, never the D1 message.

`tool_run_started` inserts the row and ignores repeats. A completed event
upserts the row, then recomputes that tool's `tool_status` from at most its
latest 500 runs in the last 24 hours, so a busy tool can't make one write read
an unbounded number of rows. The tests run against workerd's local D1 and
assert `rows_read`.

`apps/tools/app/api/telemetry/route.ts` enriches metadata with request IP and
user agent when available, then calls `recordToolRun`.
`apps/tools/lib/cloudflare-d1.ts` reads `SERP_TOOLS_DB` from the OpenNext
Cloudflare context. `packages/tool-telemetry/src/d1.ts` owns D1 inserts,
upserts, dashboard summaries, and status recomputation.

Telemetry is D1 only. If the binding is unavailable, the endpoint returns HTTP
503 (`d1_unavailable`) instead of discarding the event or writing to a
compatibility database.

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

The browser smoke test that CI runs against a local Worker can also run against
a deployed one. It writes real tool runs into that environment's D1, so use
staging (see the README for local use and the dashboard token):

```bash
pnpm -C apps/tools smoke:browser --base-url https://staging.tools.serp.co
```

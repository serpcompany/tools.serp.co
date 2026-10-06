# D1 telemetry

The D1 database behind `/api/telemetry` and the internal tools dashboard: its
schema, how it changes, and the write contract. Environment, migration and
dashboard access commands are in the [Cloudflare runbook](cloudflare.md).

## Database

The app writes tool-run telemetry to Cloudflare D1 through the Worker binding
`SERP_TOOLS_DB`.

Every environment uses the same binding name, Drizzle schema, migration
directory (`apps/tools/migrations`) and `d1_migrations` ledger, with its own
database (see [Environments](cloudflare.md#environments)).

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
| `status`       | `TEXT`    | no   | `started`, `succeeded`, `failed`, `handed_off` or `abandoned`. |
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
| `event`                                   | Required. `tool_run_started`, `tool_run_succeeded`, `tool_run_failed`, `tool_run_handed_off` or `tool_run_abandoned`. |
| `runId`, `toolId`                         | Required. Letters, digits, `_` and `-`, up to 80 characters.             |
| `startedAt`                               | Required. A date within 24 hours of the server clock.                    |
| `durationMs`, `inputBytes`, `outputBytes` | Optional. Non-negative numbers up to 10¹².                               |
| `errorCode`                               | Optional. Letters, digits and `_.:-`, up to 64 characters.               |
| `from`, `to`                              | Optional and not stored. Values that don't fit are dropped.              |
| `metadata`                                | Optional. Flat object, at most 20 keys and 4 KB. See below.              |

Metadata keys outside the allowlist (`METADATA_KEYS` in `validate.ts`, see
[telemetry.md](../telemetry.md)) are dropped; strings are cut to 256 characters
and nested values are stored as JSON strings.

Invalid events get `400` with a stable code in `error` (`invalid_json`,
`invalid_event`, `invalid_run_id`, and so on). D1 failures return
`d1_write_failed` and log only the error class, never the D1 message.

`tool_run_started` inserts the row and ignores repeats. `tool_run_abandoned`
only updates a row that is still `started`, so a page closing after a run
finished never overwrites its outcome. Any other ending event upserts the row, then recomputes that tool's `tool_status` from at most its
latest 500 runs in the last 24 hours, so a busy tool can't make one write read
an unbounded number of rows. The tests run against workerd's local D1 and
assert `rows_read`.

`apps/tools/app/api/telemetry/route.ts` ignores requests with `Sec-GPC: 1`,
adds the server-only `release`, `ip` and `userAgent`
(`apps/tools/lib/telemetry-request.ts`), then calls `recordToolRun`. Runs older
than 90 days are deleted with `pnpm -C apps/tools telemetry:purge` (see
[telemetry.md](../telemetry.md#retention)).
`apps/tools/lib/cloudflare-d1.ts` reads `SERP_TOOLS_DB` from the OpenNext
Cloudflare context. `packages/tool-telemetry/src/d1.ts` owns D1 inserts,
upserts, dashboard summaries, and status recomputation.

Telemetry is D1 only. If the binding is unavailable, the endpoint returns HTTP
503 (`d1_unavailable`) instead of discarding the event or writing to a
compatibility database.

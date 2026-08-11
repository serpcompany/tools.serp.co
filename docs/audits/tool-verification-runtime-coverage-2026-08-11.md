# Tool verification and runtime-observation coverage — 2026-08-11

This audit records repository and local-runtime evidence at commit
`7714be8cc5b21695daafa659cd31b31db5935850`. It covers every active Tool id
through the Catalog-backed operational projection. It did not access production
data or secrets, call a deployed target, write a remote database, deploy, or
change a schema.

The exact Tool-id gap lists are in the sanitized
[machine-readable companion](./tool-verification-runtime-coverage-2026-08-11.json).
The companion is dated evidence, not a new source of catalog or health truth.
Its dated
[stdout-only reproducer](../../scripts/audit-tool-coverage.mjs)
recomputes the file from tracked Catalog, code, fixture, and test sources.

## Summary

The current application can populate catalog identity and most execution
provenance for an all-Tools console row. It cannot populate a trustworthy
per-Tool verification result or runtime-observation state from a fresh clone.
Those facts either are not persisted by Tool id or require an explicitly
authorized environment query.

| Projection                                     | Covered |   Gap | Meaning                                                                                     |
| ---------------------------------------------- | ------: | ----: | ------------------------------------------------------------------------------------------- |
| Active Catalog Tool ids                        |   2,807 |     0 | Publication intent only                                                                     |
| Explicit execution provenance                  |   2,804 |     3 | Three editor placeholders remain explicit unknowns                                          |
| Reusable fixture availability                  |   2,185 |   622 | Input exists; no behavior result is implied                                                 |
| Started and succeeded telemetry emission       |   2,654 |   153 | The active UI route calls `beginToolRun` and `finishSuccess`                                |
| Failed telemetry emission                      |   2,652 |   155 | The route also has an explicit `finishFailure` path                                         |
| Browser functional-fixture mapping             |   2,120 |   687 | The smoke source has a candidate functional path; it has not necessarily passed             |
| Exact Tool-id literal in a deterministic test  |     134 | 2,673 | Inventory aid only; many references assert catalog or rendering structure                   |
| Portable retained per-Tool verification result |       0 | 2,807 | No current evidence store joins a result, invariant, revision, environment, scope, and time |
| Authorized runtime-observation evidence        |       0 | 2,807 | Every id remains unknown because no runtime environment query was authorized                |

Absence in any row remains absence or unknown. It is never converted to success
or failure.

## Portfolio projection

The operational Catalog reports 2,807 active ids. Its sorted id list hashes to
`sha256:fadb77ac2e1c68c14863a3ebd4ca43cde6692e9bde72bfacaf1026b8baeda030`.

| Operation    | Active Tools |
| ------------ | -----------: |
| convert      |        2,475 |
| download     |          292 |
| compress     |           24 |
| view         |            7 |
| edit         |            4 |
| audio-editor |            1 |
| bulk         |            1 |
| combine      |            1 |
| image-editor |            1 |
| video-editor |            1 |

| Selected renderer                              | Active Tools | Started/succeeded instrumented | Gap |
| ---------------------------------------------- | -----------: | -----------------------------: | --: |
| generic                                        |        2,359 |                          2,359 |   0 |
| downloader                                     |          292 |                            292 |   0 |
| table                                          |          139 |                              0 | 139 |
| pdf                                            |           11 |                              0 |  11 |
| placeholder                                    |            3 |                              0 |   3 |
| not-found selector with dedicated static route |            3 |                              3 |   0 |

The three active `not-found` selector results are `batch-compress-png`,
`character-counter`, and `csv-combiner`; each has a dedicated static page and
an instrumented component. The three provenance unknowns are `audio-editor`,
`image-editor`, and `video-editor`, whose current renderer is only a
placeholder.

Execution provenance is multi-valued when one Tool path can use more than one
engine profile:

| Execution profile set         | Active Tools | Started/succeeded instrumented | Gap |
| ----------------------------- | -----------: | -----------------------------: | --: |
| client-only                   |          806 |                            656 | 150 |
| client-only + server-assisted |            8 |                              8 |   0 |
| client-only + server-executed |        1,505 |                          1,505 |   0 |
| server-assisted               |          101 |                            101 |   0 |
| server-executed               |          384 |                            384 |   0 |
| unknown                       |            3 |                              0 |   3 |

All current emitters are browser components. A server-assisted or
server-executed row therefore means the UI observes its call, not that the
server API independently emits a Tool run. Direct API calls and failures before
the browser receives a response are not independently covered.

## Fixtures and verification

`apps/tools/benchmarks/fixture-matrix.json` contains 93 format entries: 91
`ready` entries whose referenced files exist and two `missing` entries. It also
contains four Tool-specific fixtures. Joining a Tool by registry id first, then
using a Tool-specific fixture or its exact `from` value, yields 2,185 Tools with
an available reusable input and 622 gaps.

This join is deliberately conservative and still overstates runnable behavior:

- all 292 download Tools lack a registered source fixture;
- 327 convert Tools lack a fixture, including 85 table-renderer Tools;
- the three editor placeholders lack fixtures;
- fixture presence says nothing about license quality, engine compatibility,
  expected output, or a passing result.

### Deterministic suite

The root test command discovers 57 committed test entrypoints. Exact quoted
Tool-id literals occur for 134 active ids, but those references mix distinct
invariants: catalog identity, route and metadata projection, renderer and
provenance selection, downloader page shape, rate limiting, and a small number
of behavior checks. There is no maintained Tool-id-to-test/invariant manifest,
so the remaining 2,673 ids are `unknown`, not “untested,” and the 134 references
are not “verified.”

`pnpm check`, `pnpm test`, typechecking, catalog verification, and documentation
verification return an ephemeral process result. They do not retain a
per-Tool result with revision, environment, scope, time, and invariant.

### Browser smoke and benchmark

`pnpm smoke:tools:browser` selects active Catalog ids and has a functional
candidate for 2,120 ids: the three dedicated Tool fixture handlers plus generic
renderer Tools with an available input fixture. The remaining 687 exact ids are
listed in the companion.

A local five-Tool sample on Node 22.23.1 produced:

| Tool id                | Result | Interpretation                                           |
| ---------------------- | ------ | -------------------------------------------------------- |
| `character-counter`    | pass   | Dedicated functional handler                             |
| `json-to-csv`          | pass   | Dedicated functional handler                             |
| `download-loom-videos` | warn   | No source fixture; route load only                       |
| `csv-to-sql`           | fail   | Table UI does not match the generic dropzone flow        |
| `pdf-editor`           | fail   | PDF UI does not match the generic dropzone/progress flow |

The ignored structured artifact retained only two passes, two failures, five
items, duration, the selection hash, and the failing aggregate status. It did
not retain the Tool ids, per-id result, warning count, error, fixture, or exact
invariant. The console therefore cannot ingest this artifact as per-Tool
evidence. `pnpm benchmark:tools:browser` uses the same Catalog selection but
measures navigation timing only and must never be treated as correctness.

### Deployed canary

The Cloudflare canary's safe-read surface names four Tool routes:
`mp4-to-mp3`, `download-loom-videos`, `youtube-to-transcript`, and
`pdf-editor`. Optional native checks exercise four API engine paths but do not
record registry Tool ids. The optional telemetry write uses synthetic id
`cloudflare-canary`, records only a started event, and is not catalog coverage.
The retained canary artifact also contains aggregate counts rather than
per-check or per-Tool results. No deployed canary was run during this audit.

### Concrete source and artifact paths

| Concern                             | Current path                                                       |
| ----------------------------------- | ------------------------------------------------------------------ |
| Catalog projection                  | `packages/app-core/src/lib/tool-catalog-adapter.mjs`               |
| Renderer grouping                   | `apps/tools/lib/tool-renderer.ts`                                  |
| Execution profiles                  | `apps/tools/lib/tool-execution-provenance.ts`                      |
| Fixtures                            | `apps/tools/benchmarks/fixture-matrix.json`                        |
| Browser telemetry contract          | `packages/tool-telemetry/src/client.ts`                            |
| Browser emitters                    | Ten component paths in the companion's `sources.telemetryEmitters` |
| Telemetry API                       | `apps/tools/app/api/telemetry/route.ts`                            |
| Telemetry validation/write boundary | `packages/tool-telemetry/src/server.ts`                            |
| D1 binding                          | `apps/tools/lib/cloudflare-d1.ts`                                  |
| D1 writes, summaries, and queries   | `packages/tool-telemetry/src/d1.ts`                                |
| D1 migration                        | `apps/tools/migrations/0001_tool_telemetry.sql`                    |
| Local migration commands            | `apps/tools/package.json`                                          |
| Dashboard query consumer            | `apps/tools/app/internal/tools/page.tsx`                           |
| Browser smoke and benchmark         | `scripts/run-browser-check.mjs`                                    |
| Deployed canary                     | `apps/tools/scripts/canary-cloudflare-deployed.mjs`                |
| Retained evidence                   | `scripts/lib/run-evidence.mjs` → `.artifacts/runs`                 |
| Portfolio audit reproducer          | `scripts/audit-tool-coverage.mjs`                                  |

## Telemetry and D1

The current browser contract emits `tool_run_started`,
`tool_run_succeeded`, and `tool_run_failed` to `/api/telemetry`. The endpoint
adds request IP and user-agent metadata and writes D1 through
`packages/tool-telemetry`.

The 153 started/succeeded gaps are all 139 table Tools, all 11 PDF view/edit
Tools, and the three editor placeholders. `character-counter` and
`html-to-markdown` begin and finish successful runs but have no explicit failed
event path, producing the 155 failed-event gaps.

The browser uses fire-and-forget beacon/fetch delivery with no acknowledgement,
retry, or failed-delivery observation. A recorded start may remain unfinished,
and a missing event cannot distinguish blocked delivery, uninstrumented code,
abandoned work, or a server failure.

### Current schema fit

| Console fact                         | Current D1 support                           | Gap                                                                                                 |
| ------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tool id and started/succeeded/failed | `tool_runs.tool_id`, `status`                | No catalog foreign key or instrumentation declaration                                               |
| Environment                          | none                                         | Cannot separate local, preview, production, or synthetic observations                               |
| Revision                             | none                                         | Cannot relate a run to deployed code                                                                |
| Scope/invariant                      | optional unstructured metadata only          | Not guaranteed or queryable as a contract                                                           |
| Timestamps                           | `started_at`, `last_run_at`, `updated_at`    | No completion or ingestion timestamp; completion reuses the start time                              |
| Failure                              | status, `error_code`, JSON metadata          | Sample metadata may contain request identifiers; no explicit redaction/retention contract in schema |
| Freshness                            | hard-coded 24-hour summary and `last_run_at` | No policy/version/window field and no stale state                                                   |
| Verification evidence                | none                                         | Runtime observations cannot substitute for verification runs                                        |
| Retention                            | none                                         | No repository-owned purge job or documented D1 retention period                                     |

`tool_status.status` currently derives `unknown`, `live`, `degraded`, or
`broken` from completed runs in a fixed 24-hour window. That is a runtime
summary for observed ids, not a portfolio status. It cannot distinguish no
row, not instrumented, never observed, stale observation, missing binding, or
query failure.

### Local lifecycle exercises

All D1 exercises used an isolated OS-temporary Wrangler state and the checked-in
migration; no remote option was used.

- Before migration, a dashboard query failed because the schema was absent.
- `0001_tool_telemetry.sql` applied cleanly. Immediately afterward both tables
  contained zero rows. The dashboard query returns empty arrays, so the current
  telemetry-first UI renders no Tool rows instead of 2,807 catalog rows with
  “no observation.”
- A missing D1 binding returns a controlled HTTP 503 from the telemetry server.
  The dashboard renders a generic controlled error.
- A forced dashboard query failure renders a controlled generic error. The
  telemetry POST path instead returns the underlying database exception text in
  its HTTP 500 JSON; this can expose database internals and needs a separate
  error-handling slice.
- Unicode JSON metadata (`東京 — café 🎵`) passed the D1 JSON constraint and
  round-tripped unchanged.

Local migration is a documented manual command, not a `dev:local` preflight or
bootstrap. A fresh local app can therefore have a binding but no schema until
the developer runs the migration.

## Queryable states for the console

These states belong to separate dimensions; they are not values of one health
field.

| Dimension           | State              | Definition and source needed                                                                    |
| ------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| Verification        | `verified`         | Latest applicable retained invariant passed at the named revision, environment, scope, and time |
| Verification        | `failing`          | Latest applicable retained invariant failed with a sanitized error reference                    |
| Verification        | `stale`            | Evidence exists but is outside its accepted revision/window policy                              |
| Verification        | `never-tested`     | A known verification target exists and has no retained result                                   |
| Verification        | `unknown`          | No authoritative Tool-to-invariant mapping exists; include reason and source needed             |
| Instrumentation     | `instrumented`     | A source-owned Tool-id mapping names the emitter and covered events                             |
| Instrumentation     | `not-instrumented` | The source-owned mapping explicitly has no emitter for the path                                 |
| Instrumentation     | `unknown`          | Renderer/path ownership cannot yet be resolved                                                  |
| Runtime observation | `observed-recent`  | At least one accepted event exists in the named environment/window                              |
| Runtime observation | `observed-stale`   | A prior event exists but is outside the accepted freshness window                               |
| Runtime observation | `never-observed`   | The path is known instrumented and no event exists in that environment                          |
| Runtime observation | `unknown`          | The environment was not queried, is unavailable, or instrumentation state is unknown            |

`never-tested` is not `never-observed`; `not-instrumented` can coexist with a
deterministic verification result; and a runtime failure does not invalidate
catalog publication intent.

## All-Tools row availability now

| Dimension                 | Available now                                                                         | Needed next                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Catalog intent            | id, name, route, operation, formats, active intent                                    | Nothing for initial identity                                                                              |
| Implementation provenance | engines, owners, processing locations, profiles for 2,804 ids; explicit unknown for 3 | Resolve only the three placeholder mappings when implementations exist                                    |
| Fixture availability      | Mechanically derivable for all ids from the current matrix                            | Add input kind and source fixtures; do not infer verification                                             |
| Instrumentation           | Derivable by source audit, but not exposed as an owned projection                     | Add a code-owned Tool-id/event mapping shared by emitters and console ingestion                           |
| Verification              | Command definitions and aggregate process results only                                | Persist per-Tool/invariant results with revision, environment, scope, time, and skip reason               |
| Runtime observation       | D1 rows for an authorized environment                                                 | Catalog-first left join, environment/revision fields, freshness policy, and explicit no-observation state |
| Planning evidence         | Advisory repository evidence only                                                     | Keep separate and join only by Tool id                                                                    |
| Work state                | GitHub Issues                                                                         | Authenticated ingestion keyed by Tool id or explicit portfolio scope                                      |

## Recommended follow-up issues

### Local bootstrap and error handling

1. Add an explicit, idempotent local D1 preflight/bootstrap path and document
   whether `dev:local` should check or apply local migrations.
2. Return stable sanitized telemetry API error codes for missing schema and
   query/write failure; never return raw provider/database exception text.
3. Make the dashboard catalog-first so empty D1 renders all active ids with
   “no observation,” while missing binding/schema/query remain distinct errors.

### Instrumentation gaps

1. Create a source-owned Tool-id instrumentation projection that names started,
   succeeded, and failed coverage without inferring it from component text.
2. Add coverage for table, PDF, and eventual editor paths, and decide how
   browser and server emitters correlate one run without double counting.
3. Add explicit failed completion or an intentional no-failure contract for
   `character-counter` and `html-to-markdown`.

### Verification-evidence persistence

1. Define a Tool-id-to-invariant manifest for deterministic and browser checks.
2. Retain per-Tool results, skips, warnings, sanitized errors, revision,
   environment, scope, and timestamps; aggregate-only artifacts are insufficient.
3. Treat a missing fixture or unsupported smoke handler as skipped/unknown, not
   a pass, and keep benchmark timing outside correctness evidence.

### D1 and read-model changes

1. Design a separate verification-evidence store/read model; do not overload
   runtime `tool_runs` or `tool_status`.
2. Add queryable runtime environment, deployed revision, scope, completion or
   ingestion time, synthetic marker, freshness policy, and retention behavior.
3. Minimize or remove IP/user-agent retention and define sanitized failure
   samples before exposing them through a console.

### Operations Console ingestion

1. Build rows from the active Catalog, then left-join provenance, fixture,
   instrumentation, verification, runtime observation, and GitHub work by Tool
   id.
2. Preserve the separate states defined above and carry an unknown reason plus
   source needed.
3. Ingest GitHub work only after tickets consistently declare Tool ids or
   portfolio scope.

Production D1 coverage counts, freshness validation, retention inspection,
deployed canary execution, schema migration, deployment, and any provider or
GitHub integration mutation require human authorization and separate tickets.

## Reproduction

Use Node 22 and pnpm 10.4.1. The repository's general commands support Node
`>=20 <23`, but the audit reproducer deliberately narrows its runtime to Node
22 because it loads the tracked TypeScript projection modules directly. It
rejects other Node majors with a clear error.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm verify:catalog
pnpm verify:docs
```

The portfolio aggregates come from
`operationalToolCatalog.activeTools`, `selectToolRenderer`, and
`executionProvenance.getByToolId`. Fixture coverage joins the exact Catalog
`from` value to `fixture-matrix.json`, requires `status: ready`, and verifies
that the named file exists. Test-literal coverage scans committed `*.test.mjs`,
`*.test.ts`, and `*.test.tsx` entrypoints for exact quoted active Tool ids.

Review the complete gap lists and verify their aggregate counts with:

```bash
jq '.portfolio, .coverage | if has("activeToolCount") then . else with_entries(.value |= {covered, gap}) end' \
  docs/audits/tool-verification-runtime-coverage-2026-08-11.json
```

Recompute the portfolio memberships, coverage counts, and exact gap lists from
tracked sources and compare them byte-for-byte with the committed companion:

```bash
NODE_NO_WARNINGS=1 node \
  scripts/audit-tool-coverage.mjs \
  --source-revision 7714be8cc5b21695daafa659cd31b31db5935850 \
  | diff - docs/audits/tool-verification-runtime-coverage-2026-08-11.json
```

The command verifies that the named commit exists, that tracked test membership
matches it, and that every audited Catalog, renderer, provenance, fixture,
telemetry, and test input is byte-identical to it before emitting JSON.

Reproduce the local D1 lifecycle through the repository-owned scratch wrapper.
It supplies one isolated state directory to the complete sequence and removes
it when the shell exits. Every Wrangler command below explicitly selects
`--local`; none can reach a remote database.

```bash
pnpm scratch:run -- sh -eu <<'SH'
! pnpm -C apps/tools exec wrangler d1 execute SERP_TOOLS_DB \
  --local --persist-to "$TOOLS_SERP_SCRATCH_DIR" \
  --command 'SELECT COUNT(*) AS count FROM tool_status' --json

pnpm -C apps/tools exec wrangler d1 migrations apply SERP_TOOLS_DB \
  --local --persist-to "$TOOLS_SERP_SCRATCH_DIR"

pnpm -C apps/tools exec wrangler d1 execute SERP_TOOLS_DB \
  --local --persist-to "$TOOLS_SERP_SCRATCH_DIR" \
  --command 'SELECT (SELECT COUNT(*) FROM tool_runs) AS run_count, (SELECT COUNT(*) FROM tool_status) AS status_count' \
  --json

pnpm -C apps/tools exec wrangler d1 execute SERP_TOOLS_DB \
  --local --persist-to "$TOOLS_SERP_SCRATCH_DIR" \
  --command "INSERT INTO tool_runs (id, tool_id, status, started_at, metadata) VALUES ('unicode-audit', 'json-metadata-audit', 'started', '2026-08-11T00:00:00.000Z', json_object('label', '東京 — café 🎵')); SELECT json_extract(metadata, '$.label') AS label FROM tool_runs WHERE id = 'unicode-audit';" \
  --json

! pnpm -C apps/tools exec wrangler d1 execute SERP_TOOLS_DB \
  --local --persist-to "$TOOLS_SERP_SCRATCH_DIR" \
  --command 'SELECT * FROM deliberately_missing_audit_table' --json
SH
```

The expected sequence is a pre-migration `no such table` error, successful
migration, zero `tool_runs` and `tool_status` rows, an unchanged
`東京 — café 🎵` result, and a forced-query error. The scratch wrapper removes
its owned directory even when a command fails.

Exercise the missing-binding response and both dashboard error descriptions
without a database or network call:

```bash
NODE_NO_WARNINGS=1 node --input-type=module <<'NODE'
const { recordToolRun } = await import('./packages/tool-telemetry/src/server.ts');
const { describeDashboardLoadError } = await import('./apps/tools/lib/internal-tools-dashboard.ts');
const event = {
  event: 'tool_run_started',
  runId: 'local-audit',
  toolId: 'character-counter',
  startedAt: '2026-08-11T00:00:00.000Z',
};
console.log(await recordToolRun(event));
console.log(describeDashboardLoadError(new Error('no such table: tool_status')));
console.log(describeDashboardLoadError(new Error('forced local query failure')));
NODE
```

The first result is a controlled 503. The dashboard maps missing schema to its
specific migration message and an arbitrary query failure to a generic message
without echoing either raw error. The telemetry write path's separate raw-error
behavior follows directly from `recordToolRun`'s catch path and remains a
recommended error-handling follow-up.

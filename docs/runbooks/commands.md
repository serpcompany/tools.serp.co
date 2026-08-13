# Command roles and authority

Command names describe the target and effect. Do not replace an explicit role
with a shorter alias. `pnpm check` remains the deterministic, read-only local
gate; none of the live, mutating, or performance roles below belongs in it.

## Local development and preview

| Command                                         | Network access                                                                   | Repository writes                                                    | External writes                                  | Authority and evidence                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:local -- [supported Next.js options]` | Serves locally; application behavior may call configured services                | Reproducible `.next` cache only                                      | None by the wrapper                              | Agent-safe. Supported arguments are forwarded explicitly; Turbopack and remote trace upload are refused. No retained evidence by default. |
| `pnpm preview:cloudflare:local`                 | Local Wrangler preview; application requests may call configured public services | Ignored Cloudflare build caches, `.open-next`, and `.wrangler/state` | None; `wrangler dev --local` is not a deployment | Agent-safe. This is distinct from any remote preview and from production deploy. No retained evidence by default.                         |

Use `pnpm dev:local -- --port 3100 --hostname 127.0.0.1` to request an
exact port and hostname. The wrapper also supports the local HTTPS and
source-map flags listed by `pnpm dev:local -- --help`. It rejects unknown
arguments instead of silently ignoring them.

## Dedicated Wayfinder preview

The named Wrangler environment `wayfinder-preview` resolves only to the
`tools-serp-co-wayfinder-preview` Worker at
`https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev`. It is
workers.dev only: its explicit empty route list prevents the production custom
domain from being inherited. Its non-inheritable bindings explicitly name the
preview D1 database, preview R2 cache bucket, and preview self-reference.

| Command                                                                                                                                                     | Network access                        | Repository writes                                                                  | External writes                                       | Authority and evidence                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm prepare:cloudflare:wayfinder-preview -- --revision <full-commit-sha>`                                                                                 | None required                         | Ignored `.next` and `.open-next` build output plus ignored structured run evidence | None; Wrangler receives `--dry-run`                   | Agent-safe after the branch is committed and clean. Requires the exact 40-character commit at `HEAD`, prints Wrangler's resolved binding summary, and records a local structured artifact.                                                                                                                                        |
| `pnpm deploy:cloudflare:wayfinder-preview -- --revision <full-commit-sha>`                                                                                  | Cloudflare API                        | Ignored `.next` and `.open-next` build output plus ignored structured run evidence | Uploads a new version of the dedicated preview Worker | Human-controlled. Requires explicit preview authorization, an exact clean revision, and authenticated Cloudflare access.                                                                                                                                                                                                          |
| `pnpm -C apps/tools check:tool-factory -- --base-url <canonical-origin> --environment DEV/STAGING --revision <full-commit-sha> --screenshot <ignored-path>` | Canonical Wayfinder HTTPS origin only | Ignored screenshot plus ignored structured run evidence                            | Safe authenticated reads only                         | Human-controlled for the deployed target. Requires `TOOL_FACTORY_CF_AUTHORIZATION` through the environment, refuses every noncanonical origin before reading the cookie, verifies the table interactions, copied-view restoration, and visible revision/environment, and records sanitized evidence linked to #50/#105/#106/#107. |

Both commands rebuild with the dedicated workers.dev origin and pass
`TOOLS_SERP_DEPLOYED_REVISION` as a runtime variable. The wrapper refuses a
dirty worktree or a revision different from `HEAD`. Neither command provisions
resources, applies migrations, changes routes, or targets the production
Worker. Their target topology is read from the canonical Wrangler configuration
rather than duplicated in the executable wrapper. A successful build plus
Wrangler validation/deployment records revision-scoped structured evidence
linked to issue #77.

## Read-only portfolio audit

| Command                                                                                                 | Network access | Repository writes | Authority and evidence                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | -------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --silent audit:tool-coverage -- --source-revision <full-commit-sha>`                              | None           | None; JSON stdout | Agent-safe. Requires Node 22 and refuses to run unless all Catalog, renderer, provenance, fixture, telemetry, and tracked-test inputs match the named source revision exactly.           |
| `pnpm --silent audit:tool-expansion-gap -- --source-revision <full-commit-sha> --format <json\|report>` | None           | None; stdout only | Agent-safe. Requires Node 22 and pins the complete local reproducer module graph plus Catalog/Tool execution inputs. JSON is the all-Tool read model; report is its concise human index. |

This audit command reports mechanically derived coverage and gap memberships.
It does not run Tool behavior, query an environment, or turn missing evidence
into a pass or failure.

The expansion-gap projection further joins exact dispatch, processor contract,
implementation provenance, runtime declarations, blockers, and explicitly
labeled planning assumptions by canonical Tool id. Its family recommendations
are planning inputs, not support registrations or runtime evidence. The accepted
issue #87 baseline and indexed output are retained in the
[Tool processor expansion-gap evidence](../audits/tool-processor-expansion-gap-2026-08-12.md).

## Local before/after workflow proof

| Command                                                                                | Network access                                                | Repository writes                                                                     | Authority and evidence                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm proof:tool-workflow -- --baseline <full-commit-sha> --current <full-commit-sha>` | None after dependencies are available in the local pnpm store | Ignored disposable build state and `.artifacts/runs/<run-id>` retained-debug evidence | Agent-safe. Requires Node 22, an ancestor baseline, an explicit full SHA for each revision, and a clean current `HEAD`. The same evaluator replays semantic browser checks against disposable checkouts of both revisions, probes the current `ToolWorkflow.run` seam, and runs the ownership analyzer symmetrically against both raw refs. |

The documented historical comparison point is
`d4499e333450f5bc501e3842d37deb029717aef4`, but the command does not silently
choose it. The retained `comparison.json` is validated before it is written;
`report.html` is derived from that data and includes the exact reproduction
command. The report deliberately says **15.18% supported** (426 of 2,807 active
Tool IDs) and **deployed behavior remains unproven**. A local PASS therefore
means the tested workflow is safer and more centralized, not that every Tool
works or that a deployed environment has been validated.

## Smoke, benchmark, and deployed canary

These commands have network access to their named target and write a structured
artifact under ignored `.artifacts/runs`. They do not write raw JSON, Markdown,
responses, URLs, filenames, or credentials. See the
[artifact lifecycle runbook](./artifacts.md).

| Command                                                                                                                | Purpose                                                 | Target and side effects                                                                                                                                                                                                                                                        | Authority and evidence                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm smoke:tools:browser -- --environment <local\|preview\|production> --revision <commit> [--base-url <origin>]`     | Browser correctness assertions with registered fixtures | Reads the target and performs the Tool interactions under test. It does not collect performance as a result dimension.                                                                                                                                                         | Local is agent-safe. A deployed target requires explicit target authorization. Records command, revision, environment class, all/subset scope, selected-Tool hash, result counts, runtime, and expiry.                                       |
| `pnpm benchmark:tools:browser -- --environment <local\|preview\|production> --revision <commit> [--base-url <origin>]` | Browser navigation performance measurement              | Reads the target. It does not execute Tool correctness/fixture assertions.                                                                                                                                                                                                     | Local is agent-safe. A deployed target requires explicit target authorization. Records all/subset scope, selected-Tool hash, and sanitized sample count/min/p50/p95/max navigation timings.                                                  |
| `pnpm canary:cloudflare:deployed -- --environment <preview\|production> --base-url <origin> --revision <commit>`       | Deployed Cloudflare route/API canary                    | Has network access and performs safe reads by default. `--allow-telemetry-write` explicitly adds one synthetic telemetry write. `--include-native` explicitly exercises native-processing POSTs. `MEDIA_FETCH_CANARY_URL` adds its named native check through the environment. | Requires explicit authorization for the target. Production secrets stay in environment variables and never appear in arguments or artifacts. Always records a structured artifact; failures cannot be masked with a no-fail option.          |
| `pnpm evidence:promote:tool-journeys -- --run <run-id>`                                                                | Promote reviewed Tool Journey browser evidence          | Reads one ignored local run manifest and updates only `docs/audits/tool-verification/retained-runs.json`. It rejects dirty, duplicate, non-browser, or invalid journey evidence.                                                                                               | Agent-safe for a reviewed local run. The retained source manifest remains historical evidence; the verification module separately derives whether each journey is current, verified, incomplete, failed, warned, skipped, stale, or invalid. |
| `pnpm generate:tool-verification-inputs`                                                                               | Regenerate Tool Journey currentness inputs              | Hashes tracked executable sources, the dependency lock, browser-runner sources, and exact fixture bytes into the checked generated manifest.                                                                                                                                   | Agent-safe local write. Review and commit the generated diff; the test suite rejects stale generated input revisions.                                                                                                                        |

The revision is the full 40-character commit actually running at the target.
`preview` evidence maps to the pull-request retention class; `production`
evidence maps to `main`. Browser local runs may add `--dirty` when uncommitted
inputs contributed.

## Data, upload, generation, and deploy roles

These operations are excluded from `pnpm check`. Remote external writes are
human-controlled. An implementation agent may inspect commands and use an
available dry-run, but must not provision, remotely migrate/import, upload, or
deploy without explicit human direction.

| App command (`pnpm -C apps/tools …`)       | Target and writes                                                    | Authority                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `generate:cloudflare:types`                | Reads Wrangler configuration and modifies generated repository types | Generator contract; check/write behavior is owned by issue #59. Review the repository diff.                    |
| `migrate:d1:local`                         | Writes only local Wrangler D1 state                                  | Agent-safe when required by an implementation issue.                                                           |
| `import:d1:local`                          | Reads an explicitly selected source and writes local D1 state        | Agent-safe only with non-sensitive fixture data. Legacy reconciliation rules remain in the Cloudflare runbook. |
| `provision:d1:preview`                     | Creates a remote preview D1 database; external write                 | Human-controlled.                                                                                              |
| `provision:d1:production`                  | Creates a remote production D1 database; external write              | Human-controlled.                                                                                              |
| `migrate:d1:preview:remote`                | Applies migrations to remote preview D1; external write              | Human-controlled.                                                                                              |
| `migrate:d1:production:remote`             | Applies migrations to production D1; external write                  | Human-controlled.                                                                                              |
| `import:d1:preview:remote`                 | Imports reconciled rows into remote preview D1; external write       | Human-controlled.                                                                                              |
| `import:d1:production:remote`              | Imports reconciled rows into production D1; external write           | Human-controlled.                                                                                              |
| `upload:r2:ffmpeg:production -- --dry-run` | Prints the proposed production R2 object uploads; no external write  | Agent-safe inspection after the Cloudflare build creates the source assets.                                    |
| `upload:r2:ffmpeg:production`              | Uploads public FFmpeg assets to production R2; external write        | Human-controlled.                                                                                              |
| `deploy:cloudflare:wayfinder-preview`      | Builds and uploads the dedicated workers.dev-only preview Worker     | Human-controlled. Exact revision and explicit preview authorization are required.                              |
| `deploy:cloudflare:production`             | Builds and deploys the production Worker; external write             | Human-controlled. Merge, secrets, routes, and deployment approval remain with the human owner.                 |

# Tool fixtures and verification

The inputs Tools are tested with, and the app checks that run outside
`pnpm check`: the render snapshot, which proves a refactor changed no page, and
the Tool sweep, which runs every converter and compressor. Paths are under
`apps/tools/`. [apps/tools/README.md](../../apps/tools/README.md) maps the app's other topics.

## Fixtures

Benchmark fixtures and their declared coverage live under `benchmarks/`. In
`benchmarks/fixture-matrix.json`, `formats` is keyed by input format and
records `ready` or `missing`; custom Tool fixtures live under `toolFixtures`. Fixtures are reusable inputs, not proof that a Tool works.

## Deterministic checks

For deterministic verification from the repository root, run `pnpm test`.
Application-only checks are `pnpm -C apps/tools lint` and
`pnpm -C apps/tools typecheck`. Benchmark, browser, deployed-environment, and
network-backed checks are separate operations and must not be described as
part of the deterministic test result. [AGENTS.md](../../AGENTS.md#verification)
says which checks each kind of change needs.

## Render snapshot

`pnpm -C apps/tools render-snapshot snapshot --base-url <url> --out <dir>`
records every page, sitemap file and redirect a running Worker serves;
`render-snapshot diff <base> <head>` exits 1 if a refactor changed any of them.
Build both the same way; only `cf:build:production` covers ads and indexing.

## Tool sweep

`pnpm -C apps/tools tool-sweep --base-url http://localhost:8787` runs every
active converter and compressor Tool once in headless Chromium against a local
Worker (started as in [the browser smoke runbook](browser-smoke.md)), checks
each saved file with `lib/convert/output-format.ts` and writes
`benchmarks/tool-sweep-results.json`. `--resume` continues an interrupted run;
`--summary` prints the Markdown table. It measures; it isn't part of
`pnpm check`. `--channel chrome` (or `msedge`) runs an installed Chrome or Edge
instead of Playwright's Chromium, whose codecs can differ (H.264, HEVC and AAC
are proprietary); each run records its channel and browser version. Each row
records the commit it was measured at, so `--only <ids>` re-measures some Tools
without touching the others. That commit can be a PR branch's, absent from `staging` after a squash merge (the #224 rows
record `ca5b9a5`); find it through the PR.

After any sweep, run `pnpm -C apps/tools tool-status` and commit
`benchmarks/tool-status.csv` and `benchmarks/tool-status-summary.md` with the
results; `pnpm test` fails until the view matches them. The view joins the
sweep with the catalog and keyword demand (see
[ARCHITECTURE.md](../../ARCHITECTURE.md#canonical-sources-of-truth)).

Never hand-merge either file. On a conflict in `tool-sweep-results.json`, take
`staging`'s copy
(`git checkout origin/staging -- apps/tools/benchmarks/tool-sweep-results.json`),
re-measure your Tools against a local Worker with
`pnpm -C apps/tools tool-sweep --base-url <url> --only <your ids>`, then run
`pnpm -C apps/tools tool-status`. Leave out `--resume`: it skips every Tool that
already has a measured row, including the ones `staging`'s copy measured
before your change. On a conflict in the view alone, run `tool-status`.

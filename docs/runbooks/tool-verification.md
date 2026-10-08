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
`pnpm check`.

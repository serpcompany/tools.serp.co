# SERP Tools

Monorepo for tools.serp.co and shared SERP tool packages.

Start with the [architecture map](./ARCHITECTURE.md),
[domain glossary](./CONTEXT.md), and [documentation index](./docs/README.md).

## Common commands

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm dev:local
pnpm preview:cloudflare:local
pnpm test
pnpm lint
pnpm typecheck
pnpm verify:catalog
pnpm verify:docs
pnpm check:links
pnpm artifacts:cleanup
```

`pnpm check` is the highest local verification seam. It composes deterministic
lint, typechecking, the complete automated-test suite, agent/documentation/Tool
catalog structural verification, and the production-faithful Cloudflare build.
It does not exercise deployed systems or run link checks, canaries, benchmarks,
syncs, uploads, deploys, or remote migrations.

Live, mutating, development, preview, smoke, and benchmark operations are
listed with their side effects and authority boundaries in the
[command roles runbook](./docs/runbooks/commands.md).

Nontrivial local and CI evidence uses the structured run manifest described in
the [artifact lifecycle runbook](./docs/runbooks/artifacts.md). Local evidence
is ignored under `.artifacts/runs`; cleanup is dry-run by default and never
cleans build caches.

## Test suite

Use Node.js `>=20 <23` and pnpm `10.4.1`. From a fresh clone:

```bash
pnpm install --frozen-lockfile
pnpm check
```

The root test command discovers committed `node:test` entrypoints, rejects
misnamed or non-test files, and runs them in app, package, and repository-owned
groups. It is deterministic and requires no network access, production
credentials, ignored local inputs, or repository writes.

## Downloader lander outbound links

Downloader landing pages must not contain guessed outbound links.

The tool registry lives at:

```text
packages/app-core/src/data/tools.json
```

Any URL under these fields is treated as a public lander outbound link and must be verified:

```text
content.productLinks.*
content.sourceLinks[].url
```

Before changing downloader page content, run the separate network-backed check:

```bash
pnpm check:links
```

For a single tool while editing:

```bash
node scripts/validate-lander-outbound-links.mjs --tool-id=download-tube8-videos
```

The validator follows redirects and fails on confirmed broken links and source-site Official Links:

```text
HTTP 404
HTTP 410
Official Links that point back to the source platform, e.g. Tube8 -> https://www.tube8.com/
```

Do not invent links from slugs. In particular, do not add guessed URLs like:

```text
https://apps.serp.co/<slug>
https://github.com/serpapps/<slug>
```

unless the exact URL has been checked and does not return 404/410. Do not add Official Links to the source platform/site itself. Prefer verified `serp.ly` product links when available.

## Git hooks

This repo includes a pre-commit hook under `.githooks/` that runs outbound-link validation when lander data changes.

Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

The hook runs:

```bash
pnpm check:links
node scripts/validate-tools.mjs
```

for relevant staged changes.

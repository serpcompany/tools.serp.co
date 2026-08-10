# SERP Tools

Monorepo for tools.serp.co and shared SERP tool packages.

Start with the [architecture map](./ARCHITECTURE.md),
[domain glossary](./CONTEXT.md), and [documentation index](./docs/README.md).

## Common commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm lint:tools
pnpm lint:links
pnpm verify:docs
pnpm -C apps/tools typecheck
```

## Test suite

Use Node.js `>=20 <23` and pnpm `10.4.1`. From a fresh clone:

```bash
pnpm install --frozen-lockfile
pnpm test
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

Before changing downloader page content, run:

```bash
pnpm lint:links
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
pnpm lint:links
node scripts/validate-tools.mjs
```

for relevant staged changes.

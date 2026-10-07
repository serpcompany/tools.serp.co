# SERP Tools

Monorepo for tools.serp.co and shared SERP tool packages.

[AGENTS.md](./AGENTS.md) maps the repository's areas and the doc that owns
each one. Start with the [architecture map](./ARCHITECTURE.md) and the
[domain glossary](./CONTEXT.md).

## Common commands

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm verify:catalog
pnpm check:links
```

`pnpm check` is the highest local verification seam. It composes deterministic
lint, typechecking, the complete automated-test suite, agent workflow and Tool
catalog structural verification, and the production-faithful Cloudflare build.
It does not exercise deployed systems or run link checks, canaries, benchmarks,
syncs, uploads, deploys, or remote migrations.

CI also runs a browser smoke test against the real Worker on a freshly
migrated local D1 (the `smoke` job). What it covers and how to run it locally
or against staging: [docs/runbooks/browser-smoke.md](docs/runbooks/browser-smoke.md).

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

Downloader Landers must not contain guessed outbound links. Before changing a
URL under `content.productLinks` or `content.sourceLinks` in the Tool registry,
follow [docs/agents/downloader-lander-links.md](docs/agents/downloader-lander-links.md)
and run the network-backed `pnpm check:links`.

## Git hooks

Enable the repository hooks under `.githooks/` once per clone:

```bash
git config core.hooksPath .githooks
```

- `pre-commit` runs `pnpm check:links` when the Tool registry, the link
  validator, an `AGENTS.md` or a `README.md` changes, and
  `node scripts/validate-tools.mjs` when app or registry code changes.
- `pre-push` runs the app's lint and typecheck and `pnpm verify:catalog`.

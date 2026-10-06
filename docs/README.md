# Documentation index

This is the index of every current document in the repository. Everything
under `.archive/` is historical evidence as a whole and is not indexed file by
file.
Current guidance describes the current branch and is the source to follow.
Historical and advisory material is evidence at its recorded scope and time;
it must not be treated as current operating truth or active work.

The retired catch-all `docs/knowledge`, `docs/plans`, and `docs/planner`
categories are rejected. Current guidance belongs beside its owner or in `docs/runbooks`;
dated audits and advisory research exports belong in `.archive/` at the
repository root; data an owner still reads lives with that owner; active work
belongs in GitHub Issues.

Docs follow the serp [docs-are-maps](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/docs-are-maps.md)
budgets: maps (`AGENTS.md`, `README.md`) at most 120 lines and every other doc
at most 300, counted as lines wrapped at 100 characters. When a doc outgrows
its budget, split it by topic. Name files and folders under `docs/` in
kebab-case. `node .github/scripts/check-docs.mjs` checks both, and the
**Docs Links** workflow checks relative links in `AGENTS.md`, `README.md` and
`docs/`. The root `ARCHITECTURE.md` and `CONTEXT.md` keep their conventional
uppercase names, which agent tooling looks for (decided in #149).

## Current guidance

### Repository maps

- [Agent instruction router](../AGENTS.md)
- [Repository architecture](../ARCHITECTURE.md)
- [Domain glossary](../CONTEXT.md)
- [Repository overview and commands](../README.md)
- [ADR policy and index](./adr/README.md)

### Agent and workflow policy

- [Domain documentation convention](./agents/domain.md)
- [Downloader Lander outbound-link policy](./agents/downloader-lander-links.md)
- [GitHub issue tracker convention](./agents/issue-tracker.md)
- [Triage label vocabulary](./agents/triage-labels.md)

### Owned application and package contracts

- [Tools application contract](../apps/tools/README.md)
- [ESLint configuration package](../packages/eslint-config/README.md)
- [TypeScript configuration package](../packages/typescript-config/README.md)

### Runbooks

- [Cloudflare operations](./runbooks/cloudflare.md)
- [Browser smoke test](./runbooks/browser-smoke.md)

## Archive

Dated audits and retained research exports live in [`.archive/`](../.archive/README.md).
They are evidence at their recorded scope and time: confirm any reusable claim
against current code, current runbooks, and linked GitHub work.

# Documentation index

This is the index of every durable Markdown document in the repository.
Current guidance describes the current branch and is the source to follow.
Historical and advisory material is evidence at its recorded scope and time;
it must not be treated as current operating truth or active work.

The retired catch-all `docs/knowledge`, `docs/plans`, and `docs/planner`
categories are rejected. Current guidance belongs beside its owner or in `docs/runbooks`;
dated audits and advisory research exports belong in `.archive/` at the
repository root; data an owner still reads lives with that owner; active work
belongs in GitHub Issues.

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

## Archive

Dated audits and retained research exports live in [`.archive/`](../.archive/README.md).
They are evidence at their recorded scope and time: confirm any reusable claim
against current code, current runbooks, and linked GitHub work.

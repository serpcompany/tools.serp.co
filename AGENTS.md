# Agent instructions for tools.serp.co

tools.serp.co is a public site of free file converters, compressors, downloaders
and transcription tools: one Next.js app on Cloudflare Workers, with D1 for
telemetry. This file maps the repository's areas. Start here and open only the
doc your task needs. Use installed skills for generic TDD, review, GitHub and
safety procedures, and prefer a nearer `AGENTS.md` when one exists.

## Areas

**Architecture and boundaries.** [ARCHITECTURE.md](ARCHITECTURE.md) says which
workspace owns what, which way dependencies may point, the canonical source of
each fact, and how the Cloudflare runtime fits together. Read it before moving
code between `apps/tools` and `packages/*`, adding a binding, or adding a second
source for a fact that already has one.

**Domain language and decisions.** [CONTEXT.md](CONTEXT.md) defines Tool,
Lander, Product, execution profiles and evidence terms. Use its words in code,
issues and PRs; [docs/agents/domain.md](docs/agents/domain.md) says when to add
a term. Durable trade-offs go in ADRs, and
[docs/adr/README.md](docs/adr/README.md) says when one is warranted and how to
supersede it.

**The tools app and its catalog.** [apps/tools/README.md](apps/tools/README.md)
covers the Tool registry, routes, sitemaps, rendering, execution paths,
downloader Landers and ads. Read it before adding or changing a Tool, a route or
an execution path. A change to a downloader Lander's outbound links follows
[docs/agents/downloader-lander-links.md](docs/agents/downloader-lander-links.md):
every URL is verified, never guessed from a slug.

**Telemetry and privacy.** [docs/telemetry.md](docs/telemetry.md) says what a
tool run and an error report record, how long it is kept, how visitors opt out,
and how deletion works.
[docs/runbooks/d1-telemetry.md](docs/runbooks/d1-telemetry.md) is the D1 schema
and write contract. Read both before adding a field, an event or a migration.

**Environments and deploys.**
[docs/runbooks/cloudflare.md](docs/runbooks/cloudflare.md) covers the account;
the local, staging and production environments; the Deploy workflow, promotion
and rollback; bindings; and safe D1 access. Read it before touching
`wrangler.jsonc`, migrations, secrets or the Deploy workflow.

**Commands and tests.** [README.md](README.md) lists the commands and what
`pnpm check` covers.
[docs/runbooks/browser-smoke.md](docs/runbooks/browser-smoke.md) explains the
Playwright smoke test that CI and the Deploy workflow run, and how to run it
yourself.

**Work tracking.** GitHub Issues is the only tracker.
[docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) covers sub-issues,
dependencies, and what stays with the owner;
[docs/agents/triage-labels.md](docs/agents/triage-labels.md) defines the labels.
Read both before creating, triaging or closing an issue.

**Writing docs.** [docs/README.md](docs/README.md) says what belongs in `docs/`,
how to write it, and the size and naming rules the Docs checks enforce.

**History.** [.archive/](.archive/README.md) holds dated audits and research
exports. They are evidence at their recorded date, not current truth: confirm
any claim against the code and the docs above.

## Git workflow

Follow the serp [git workflow](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/git-workflow.md):
one issue, one branch, one PR, one squash commit on `staging`, the base branch.

- Branch: `issue-<number>-<short-slug>`, from `staging`; PRs target `staging`.
- PR title: a Conventional Commit phrased as the outcome a user notices. The
  required `PR Title` check enforces the format (`scripts/check-pr-title.mjs`).
  To revert a merge, use GitHub's Revert button; its `Revert "..."` title
  passes.
- PR body: fill in `.github/pull_request_template.md`. It starts with
  `Closes #<number>` and reports each evidence level separately.
- A fresh review agent reviews every PR; resolve each finding, re-review after
  blocking fixes, and record the outcome in the PR. Agents never merge without
  the owner's approval.
- A merge to `staging` deploys Staging (migrations, deploy, smoke tests).
  Production changes only when the owner promotes a green `staging` commit to
  `main` with a fast-forward, which deploys Production the same way. Hotfixes
  are PRs into `main`, merged back into `staging` right after. Commands and
  rollback: [docs/runbooks/cloudflare.md](docs/runbooks/cloudflare.md).

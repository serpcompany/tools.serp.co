# Agent instructions for tools.serp.co

Use this file as a routing map. Keep detailed project knowledge beside its owner
and use installed skills for generic TDD, review, GitHub, and safety procedures.

## Repository knowledge

- Architecture and ownership boundaries: `ARCHITECTURE.md`
- Shared domain glossary: `CONTEXT.md`
- Documentation index and current/evidence classification: `docs/README.md`
- Work state and tracker conventions: `docs/agents/issue-tracker.md`
- Triage vocabulary: `docs/agents/triage-labels.md`
- Domain documentation and ADR convention: `docs/agents/domain.md`
- ADR creation and supersession guidance: `docs/adr/README.md`
- Repository overview and commands: `README.md`
- Current Cloudflare runtime and data operations: `docs/runbooks/cloudflare.md`

Treat dated audits as evidence at their recorded date, not as current operating
truth. Prefer the nearest scoped `AGENTS.md` when one exists.

## Git workflow

Follow the serp [git workflow](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/git-workflow.md):
one issue, one branch, one PR, one squash commit on the base branch. That is
`main` today; the move to a `staging` base branch is #188.

- Branch: `issue-<number>-<short-slug>`, from the base branch.
- PR title: a Conventional Commit phrased as the outcome a user notices. The
  `PR Title` check reports the format (`scripts/check-pr-title.mjs`); it
  blocks merging once #154 makes it required. To revert a merge, use GitHub's
  Revert button; its `Revert "..."` title passes.
- PR body: fill in `.github/pull_request_template.md`. It starts with
  `Closes #<number>` and reports each evidence level separately.
- A fresh review agent reviews every PR; resolve each finding, re-review after
  blocking fixes, and record the outcome in the PR. Agents never merge without
  the owner's approval.
- Every merge to `main` deploys production through Workers Builds, which does
  not apply D1 migrations: run `db:migrate:production` before merging code
  that needs them (`docs/runbooks/cloudflare.md`).

## Scoped policies

- Downloader lander outbound links: `docs/agents/downloader-lander-links.md`

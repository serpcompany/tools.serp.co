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
one issue, one branch, one PR, one squash commit on `main`.

- Branch: `issue-<number>-<short-slug>`, from `main`.
- PR title: a Conventional Commit phrased as the outcome a user notices. The
  `PR Title` check enforces the format.
- PR body: fill in `.github/pull_request_template.md`. It starts with
  `Closes #<number>` and reports each evidence level separately.
- Every merge to `main` deploys production through Workers Builds.

## Scoped policies

- Downloader lander outbound links: `docs/agents/downloader-lander-links.md`

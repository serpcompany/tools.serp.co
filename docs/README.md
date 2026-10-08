# Writing docs

What belongs in `docs/` and how to write it. For what lives where, see
[AGENTS.md](../AGENTS.md).

## What belongs here

`docs/` holds prose a reader needs that the code can't show: purpose,
invariants, boundaries, the reasons behind decisions, and how to operate the
site. Policies agents follow go in `docs/agents/`, operating procedures in
`docs/runbooks/`, and durable decisions in `docs/adr/`. A topic that fits none
of these gets its own leaf, such as `docs/telemetry.md`.

Some things belong elsewhere:

- A component's own contract lives beside it, as its `README.md` (for example
  `apps/tools/README.md`), and data an owner reads lives with that owner. That
  README is a map: when its topics outgrow the map budget, each becomes a leaf
  in `docs/` that the README links, as `apps/tools/README.md` does.
- Work, plans, acceptance criteria and status belong in GitHub Issues, not in a
  doc. The old `docs/knowledge`, `docs/plans` and `docs/planner` folders were
  retired for that reason; don't recreate them.
- Dated audits, superseded material and research exports go in `.archive/` at
  the repository root. They stay useful as evidence, but they never override
  current docs or running code.
- Never store live credentials or secret values in a doc.

## Writing guidance

Write for a person who knows the business but not the history of a particular
decision. Explain purpose, scope, terms and consequences. Update a doc when a
boundary, an invariant or a term changes; implementation detail belongs in code
comments, tests or the PR description, where it can't drift from the code.

Avoid file-by-file inventories and link-only tables of contents: they duplicate
the filesystem and go stale. `AGENTS.md` maps areas, not files. Each entry says
what the reader will find and when to read it. Link a new leaf from the
`AGENTS.md` area it belongs to, or from the README of the component it
documents; an agent won't find a leaf that nothing points to.

## Size and names

Docs follow the serp
[docs-are-maps](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/docs-are-maps.md)
budgets: maps (`AGENTS.md`, `README.md`) at most 120 lines and every other doc
at most 300, counted as lines wrapped at 100 characters. When a doc outgrows its
budget, split it by topic instead of squeezing it under the limit.

Name files and folders under `docs/` in kebab-case; only `README.md` and
`AGENTS.md` are uppercase. The root `ARCHITECTURE.md` and `CONTEXT.md` keep
their conventional names (decided in #149): `CONTEXT.md` is the file the
domain-modeling skill reads, and `ARCHITECTURE.md` is the common name for a
repository's architecture map. Both are budgeted as leaves.

`node .github/scripts/check-docs.mjs` checks the sizes of the root docs, `docs/`
and each workspace `README.md`, and the names under `docs/`. The **Docs Links**
workflow checks relative links in the same files.

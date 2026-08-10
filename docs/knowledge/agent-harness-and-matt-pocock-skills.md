# Agent Harness Engineering and Matt Pocock Skills

Research date: 2026-08-10

This note compares the two approaches proposed for improving this repository.
It is research only: no skills have been installed and no repository conventions
have been changed.

## Executive Summary

The approaches operate at different layers and fit together:

- **Harness engineering** is repository and runtime design. It makes an agent's
  environment legible, gives it direct access to feedback, and mechanically
  enforces the important invariants.
- **Matt Pocock's skills** are small, composable procedures for recurring
  engineering work. The setup skill tells those procedures where this repo keeps
  issues, triage labels, domain vocabulary, and architecture decisions.

The useful direction for `tools.serp.co` is therefore not "harness or skills."
It is to improve the harness first enough that skills can discover truth and
close feedback loops reliably, then adopt only the skills that match real
workflows. Installing a skill does not compensate for missing, stale, or
unenforced repository knowledge.

## What OpenAI Means by Harness Engineering

OpenAI describes an experiment in which humans steered and Codex produced the
application code, tests, CI, documentation, observability, and internal tools.
The reported constraint shifted engineering effort away from directly writing
code and toward specifying intent, building tools and abstractions, and creating
feedback loops agents could use themselves. [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)

The practices most relevant to this repository are:

1. **Give agents a map, not one enormous instruction manual.** OpenAI reports
   that a monolithic `AGENTS.md` consumed context, diluted priorities, became
   stale, and was difficult to verify. Their alternative is a short
   `AGENTS.md` that points into a structured, versioned `docs/` knowledge base.
   [OpenAI: repository knowledge as the system of record](https://openai.com/index/harness-engineering/#we-made-repository-knowledge-the-system-of-record)
2. **Keep operational truth in the repository.** Code, Markdown, schemas,
   executable plans, and decision history are agent-legible; knowledge confined
   to chat, documents outside the repo, or people's memories effectively is not.
   [OpenAI: agent legibility](https://openai.com/index/harness-engineering/#agent-legibility-is-the-goal)
3. **Expose direct feedback loops.** OpenAI made each worktree independently
   bootable and exposed browser state, screenshots, logs, metrics, and traces to
   agents so they could reproduce and validate behavior without a human relaying
   evidence. [OpenAI: increasing application legibility](https://openai.com/index/harness-engineering/#increasing-application-legibility)
4. **Enforce invariants mechanically.** Their architecture rules, structural
   dependency directions, logging rules, naming rules, file-size limits, and
   reliability requirements are checked by custom linters and tests. Lint error
   messages include remediation guidance for the agent. Documentation expresses
   intent; automation prevents drift. [OpenAI: enforcing architecture and taste](https://openai.com/index/harness-engineering/#enforcing-architecture-and-taste)
5. **Treat failures as harness gaps.** When an agent struggles, the response is
   to identify the missing tool, guardrail, documentation, or feedback path and
   add it to the system, rather than merely repeating the request. [OpenAI: redefining the engineer's role](https://openai.com/index/harness-engineering/#redefining-the-role-of-the-engineer)
6. **Continuously collect entropy.** Agents reproduce existing patterns,
   including bad ones. OpenAI encodes "golden principles" as mechanical rules
   and runs recurring doc-gardening and targeted cleanup work instead of relying
   on occasional large cleanups. [OpenAI: entropy and garbage collection](https://openai.com/index/harness-engineering/#entropy-and-garbage-collection)

This is not a claim that every repository should copy OpenAI's unusually high
autonomy or merge posture. The article explicitly says its end-to-end behavior
depends heavily on that repository's specific structure and tooling and should
not be assumed to generalize without similar investment.
[OpenAI: increasing levels of autonomy](https://openai.com/index/harness-engineering/#increasing-levels-of-autonomy)

## What the Matt Pocock Setup Skill Actually Does

The skills project describes its skills as small, editable, composable
engineering practices rather than a framework that owns the whole development
process. For Codex and other agents, the author documents installation through
`npx skills@latest add mattpocock/skills`; this copies ordinary skill files that
the repository can edit and later update deliberately. Installing both that
copy and the managed Claude plugin duplicates every skill.
[mattpocock/skills README](https://github.com/mattpocock/skills#installation-30-second-setup)

`setup-matt-pocock-skills` is a user-invoked, prompt-driven setup workflow, not a
deterministic installer. Before writing, it inspects the git remote, root agent
instructions, existing domain documentation, ADRs, prior setup output, local
issue conventions, installed triage skill, and monorepo signals. It must present
what it found and confirm choices with the user.
[setup skill source](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md)

The setup makes three decisions:

- **Issue tracker:** GitHub, GitLab, local Markdown under `.scratch/`, or a
  user-defined workflow. It writes the result to
  `docs/agents/issue-tracker.md`.
- **Triage vocabulary:** only when the `triage` skill is installed, it maps five
  canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, and `wontfix`) to this project's actual labels in
  `docs/agents/triage-labels.md`. This records a mapping; it does not create the
  labels in the tracker, so their existence must be verified separately.
- **Domain documentation:** normally one root `CONTEXT.md` plus `docs/adr/`; for
  a genuine large monorepo it can instead use a root `CONTEXT-MAP.md` pointing
  to context-specific `CONTEXT.md` files and ADRs. It records consumer rules in
  `docs/agents/domain.md`.

It also adds or updates a concise `## Agent skills` pointer block in the
existing root instruction file. It prefers `CLAUDE.md` when present, otherwise
`AGENTS.md`, and does not create both. Crucially, it shows the proposed block and
the three generated documents for user editing before it writes anything.
[setup skill source](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md)

Downstream skills read this repository-specific configuration at runtime. Local
tracker or domain changes therefore belong in `docs/agents/*.md`, not in copied
`SKILL.md` files; the setup source says it only needs to be rerun to switch
trackers or restart setup from scratch.
[setup skill source](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md)

The public skills catalog gives the same intended scope: configure the issue
tracker, triage labels, and domain-doc layout used by downstream skills such as
triage, diagnosis, TDD, and architecture improvement.
[skills.sh: setup-matt-pocock-skills](https://www.skills.sh/mattpocock/skills/setup-matt-pocock-skills)

## How They Fit Together

| Harness concern | Skills contribution | What still belongs to this repo |
| --- | --- | --- |
| Discoverable source of truth | `AGENTS.md` pointers plus `docs/agents/` configuration | Accurate architecture, operations, product, and domain docs |
| Repeatable workflows | Composable skills for research, diagnosis, TDD, review, and planning | Project-specific commands, fixtures, credentials policy, and acceptance criteria |
| Fast feedback | Skills prescribe disciplined loops | Reliable local boot, focused tests, browser/runtime access, logs, and diagnostics |
| Architectural coherence | Domain docs and architecture-review vocabulary | Enforced boundaries, structural tests, and actionable lint failures |
| Entropy control | Repeatable review and improvement workflows | Scheduled audits, ownership, freshness checks, and removal of stale paths |

The core principle is progressive disclosure: a small root map should route an
agent to task-specific knowledge and workflows, while executable checks confirm
that the documented rules still match reality. This is the clearest overlap
between the two sources.

## Current Fit for `tools.serp.co`

The repository already has useful starting pieces:

- Root `AGENTS.md` is short and contains a concrete, mechanically checked
  outbound-link policy.
- `docs/knowledge/`, `docs/audits/`, and `docs/plans/` already separate durable
  guidance, evidence, and planned work.
- `pnpm-workspace.yaml` plus `apps/*` and `packages/*` make this a monorepo by the
  setup skill's detection rules.
- The Git remote is GitHub (`serpcompany/tools.serp.co`), so the setup skill
  would recommend GitHub Issues unless the team's real workflow says otherwise.
- There is currently no root `CONTEXT.md` or `CONTEXT-MAP.md`, no `docs/adr/`,
  and no `docs/agents/` output. The setup skill's own domain rules say missing
  domain artifacts should be created lazily when real terminology or decisions
  are resolved, not generated speculatively.
  [domain template](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/domain.md)

These observations argue for preserving the current short `AGENTS.md`, turning
it into a better index over time, and avoiding a bulk documentation rewrite.
The highest-value cleanup sequence is:

1. Establish which deployment, database, and operational paths are truly live.
2. Update or remove stale docs and configuration, with executable evidence.
3. Add a compact architecture/system map that points at the canonical files.
4. Decide the actual issue-tracker and domain-context conventions with the user.
5. Only then run the setup skill and adopt selected downstream skills.
6. Add mechanical freshness and architecture checks where recurring mistakes
   reveal a stable invariant worth enforcing.

## Decisions to Resolve Before Setup

The setup should not be run unattended. At minimum, the user needs to decide:

1. Whether GitHub Issues is the real source of work for this repository, rather
   than merely the default implied by its remote.
2. Whether the domain model is genuinely split across multiple contexts. A
   technical monorepo alone is only a signal; it does not prove that separate
   domain vocabularies are useful.
3. Which Pocock skills will actually be installed. Triage configuration is
   unnecessary when `triage` is not selected.
4. Whether skill files should be project-local and intentionally customized,
   accepting that upstream updates are then a deliberate merge rather than an
   automatic subscription.

## Primary Sources

- [OpenAI, "Harness engineering: leveraging Codex in an agent-first world"](https://openai.com/index/harness-engineering/)
- [Matt Pocock, `mattpocock/skills` repository README](https://github.com/mattpocock/skills)
- [Matt Pocock, `setup-matt-pocock-skills` source](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md)
- [skills.sh distribution page for `setup-matt-pocock-skills`](https://www.skills.sh/mattpocock/skills/setup-matt-pocock-skills)

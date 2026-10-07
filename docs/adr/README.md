# Architecture decision records

ADRs preserve durable decisions whose rationale would otherwise be expensive
to reconstruct. They are not a work tracker or a substitute for code and tests.

## When to write an ADR

Write one only when a decision is all of the following:

- expensive to reverse;
- surprising without the history that led to it; and
- the result of a real trade-off between credible alternatives.

Routine implementation choices belong in code and tests. Temporary plans,
acceptance criteria, ownership, and progress belong in GitHub Issues. Do not add
placeholder ADRs for topics the repository has not decided.

## Format and lifecycle

Name records `NNNN-short-title.md` and allocate numbers monotonically. Include
these sections:

```text
# NNNN: Decision title

Status: Proposed | Accepted | Superseded
Date: YYYY-MM-DD

## Context
## Decision
## Consequences
```

An accepted ADR records the repository revision or issue that supplied the
decision context when useful. Consequences include known costs and follow-up
constraints, not an implementation checklist.

Never delete or rewrite an accepted decision merely because the architecture
changes. Mark it `Superseded`, add a `Superseded by` link to the replacement,
and make the replacement link back with `Supersedes`. Both records remain in
this directory so the decision chain is navigable.

This directory is the ADR index: numbered file names keep it in order. Link a
new ADR from the doc for the area it decides, such as `ARCHITECTURE.md` or a
component README, so a reader of that area finds it. The **Docs Links** workflow
fails on broken relative links, including replacement links between ADRs.

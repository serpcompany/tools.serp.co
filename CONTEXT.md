# Domain glossary

This is the repository's shared domain vocabulary. Add terms only after a real
ambiguity or durable distinction has been resolved.

## Core terms

**Tool** — A user-facing capability in the `tools.serp.co` catalog, identified
by its registry `id`. A Tool can have a dedicated or shared implementation. Its
publication intent, implementation, verification, and runtime health are
separate facts.

**Product** — A separately distributed SERP offering that a Tool or Lander may
promote, such as an application or browser extension. A Product has its own
destination and lifecycle; it is not the source website named by a downloader,
and it is not made canonical by appearing in Lander content.

**Lander** — A public page that presents a Tool or Product to a particular user
intent. Multiple Landers may share one renderer or execution engine. A
keyword- or source-specific downloader Lander is still represented by its own
registry Tool id when it is shipped.

**Registry Entry** — One versioned object in
`packages/app-core/src/data/tools.json`. It records shipped catalog intent such
as Tool identity, route, operation, publication state, formats, and content.
`isActive` means intended for publication; it does not mean working, verified,
healthy, or planned.

## Execution profiles

These are the only accepted execution profiles. They describe where the Tool's
core transformation or operation runs.

- **client-only** — The core operation runs in the user's browser. Static asset
  delivery, telemetry, authentication, or unrelated network requests do not
  change this profile.
- **server-assisted** — The browser performs the core operation, but a server
  provides a necessary supporting step such as safe remote-media retrieval.
- **server-executed** — The server performs the core transformation or
  operation.

Calling a third-party source alone does not make a Tool server-assisted. The
profile changes only when repository-owned server behavior is necessary to the
Tool's operation.

## Evidence dimensions

Never collapse these dimensions into a single Tool `status`:

- **Catalog intent** — identity, route, operation, formats, presentation
  content, and active/inactive publication intent from the registry. Content
  copy does not prove its runtime-sounding statements; versioned compatibility
  copy follows [ADR 0001](./docs/adr/0001-catalog-compatibility-copy-is-intent.md).
- **Implementation provenance** — processing location, capability or engine,
  owning code/package, and whether that mapping is explicit or unknown.
- **Fixture availability** — whether a named reproducible input exists. A
  fixture does not prove the Tool works.
- **Verification evidence** — the exact invariant or behavior checked at a
  named revision, environment, scope, and time.
- **Runtime observation** — instrumented runs and derived metrics observed in a
  named environment and time window. No observation is not success or failure.
- **Planning evidence** — candidate, prioritization, or research material. It
  does not establish publication, correctness, or health.
- **Work state** — requested work, readiness, blockers, and ownership in GitHub
  Issues. Pull requests and commits are implementation and review evidence, not
  work-state authorities.

Unknown evidence remains `unknown` with the reason and the source needed to
resolve it; absence must not be converted into a positive or negative claim.

## Verification language

**Tool Journey** — One user-visible path through a Tool to a promised outcome.
Journeys are distinct when their input source or required runtime path differs,
such as file upload, direct URL, or extractor-backed URL.

**Processor Support** — An exact Tool operation has a registered processor
contract that fails closed and semantically validates its result. Processor
Support is capability, not evidence that any Tool Journey has executed.

**Verified Journey** — A Tool Journey has current controlled evidence for its
exact contract, fixture, semantic invariant, revision, and required execution
environment. Family evidence applies only through mechanically exact contract
membership.

**Fully Verified Tool** — Every primary Tool Journey promised by the Registry
Entry is a Verified Journey. An explicitly unsupported promised journey makes
the Tool partially verified rather than fully verified.

**Partially Verified Tool** — At least one, but not every, primary Tool Journey
is verified. The verified, unsupported, and unknown journeys remain visible
separately.

_Avoid_: `working`, `healthy`, or `tested` without an exact evidence scope.

## Work state

GitHub Issues is the sole authority for active work. Native issue dependencies
express blockers; labels express the agreed triage state; assignees express
ownership; commits and pull requests are implementation evidence. None of
those facts alone proves that a Tool is published or healthy.

The repository's accepted triage vocabulary is defined in
[the triage label map](./docs/agents/triage-labels.md).

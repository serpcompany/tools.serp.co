# 0001: Catalog compatibility copy is presentation intent

Status: Accepted
Date: 2026-08-11

## Context

Issue #65 moved fallback Tool-page content behind the Tool Catalog while also
requiring exact public-behavior parity. The prior application renderers
generated user-visible copy that included statements about browser processing,
uploads, file handling, and device support. Treating those strings as runtime
evidence would collapse catalog intent, implementation provenance, and observed
behavior. Repeating the full generated content on thousands of registry entries
would avoid inference but would substantially enlarge the registry and obscure
the shared compatibility rule.

## Decision

An explicit, versioned `pageContentProfile` on a registry entry is shipped
presentation intent. The Tool Catalog may expand that selected profile into the
exact compatibility copy previously shown by the application.

Profile output is not implementation provenance, verification evidence, or a
runtime observation, even when legacy wording reads like a runtime assertion.
It must not drive capability classification, health, verification results, or
operational decisions. Profiles are allowlisted and validated against the Tool
shape they support; an entry without an explicit compatibility profile receives
neutral fallback copy.

The capability and engine registry introduced under issue #67 remains the
authority for implementation provenance. Future presentation changes that rely
on processing location or engine behavior must be reconciled with that explicit
provenance rather than inferred from compatibility copy.

## Consequences

- Public fallback copy can remain stable during the Catalog migration without
  duplicating generated sections across thousands of registry records.
- Catalog consumers must treat page content as presentation intent only.
- Compatibility profiles are intentionally versioned migration debt. They can
  be retired only when entries carry equivalent explicit content or replacement
  copy is deliberately accepted against authoritative capability provenance.
- Some retained copy can be stronger than current verification evidence. The
  separation is visible in the model and tests instead of being mistaken for
  proof that a Tool works.

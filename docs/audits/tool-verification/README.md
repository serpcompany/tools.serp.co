# Retained Tool Journey verification runs

`retained-runs.json` contains sanitized, source-derived browser-run manifests.
It is historical controlled evidence, not a hand-authored list of passes.

Promote a clean, exact-revision browser run with:

```bash
pnpm evidence:promote:tool-journeys -- --run <run-id>
```

The promotion command accepts only the journey-aware browser artifact contract.
The application verification-evidence module validates each exact Tool Journey,
fixture digest, semantic invariant, environment, revision, checked requirement,
and current input revision before projecting it to the Tool Factory. Warning,
skipped, dirty, stale, incomplete, and mismatched records never become verified
journeys.

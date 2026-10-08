# Tool-planning exports

These CSV files are advisory inputs inherited from earlier Tool planning:

- `tools_planner.csv` contained candidate and previously observed Tool rows.
  It moved to `packages/app-core/src/data/tools-planner.csv` (issue #150) and
  was deleted in issue #232, once it had gone stale against the catalog. The
  generated Tool status view (`apps/tools/benchmarks/tool-status.csv`) replaced
  it; the last copy is in git history.
- `in-progress-missing-audit.csv` records an earlier gap classification.
- `veed-io.csv` contains third-party page research.

The files were retained verbatim during GitHub issue #54. Their collection
methods, observation dates, and completeness are not consistently recorded, so
their status fields must not be interpreted as current publication,
correctness, capability, or health. Join a row to a shipped Tool only through a
verified registry Tool id; names and route-shaped text are not stable joins.

No maintained command or test reads these files.

# Tool-planning exports

These CSV files are advisory inputs inherited from earlier Tool planning:

- `tools_planner.csv` contains candidate and previously observed Tool rows.
- `in-progress-missing-audit.csv` records an earlier gap classification.
- `veed-io.csv` contains third-party page research.

The files were retained verbatim during GitHub issue #54. Their collection
methods, observation dates, and completeness are not consistently recorded, so
their status fields must not be interpreted as current publication,
correctness, capability, or health. Join a row to a shipped Tool only through a
verified registry Tool id; names and route-shaped text are not stable joins.

Maintained commands that still consume these files must treat them as explicit
inputs and leave reviewable diffs. Their longer-term interface is tracked by
the Tool Catalog and generator migration issues.

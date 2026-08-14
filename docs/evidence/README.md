# Advisory evidence

This directory holds retained research and planning inputs that may help form a
hypothesis. They are not current repository policy, active work, shipped
catalog intent, verification, or runtime health.

- [Tool-planning exports](./tool-planning/README.md)
- [SEO research exports](./seo-research/README.md)
- [OSS library and tool research backlog](./oss-library-research/README.md)

Validate any reused claim against the current code, the Tool registry, and the
GitHub issue that authorizes the work. GitHub Issues remain the sole authority
for active plans, blockers, acceptance criteria, and ownership.

## Tracked CSV inventory

This table classifies every tracked CSV. `pnpm test` fails when a CSV is added,
removed, or reclassified without updating this inventory.

| Path                                                        | Classification            | Owner and permitted use                                                                            |
| ----------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/tools/benchmarks/fixtures/sample-2.csv`               | `fixture`                 | Browser evidence fixture for the second table input. Tests and browser proof may read it.          |
| `apps/tools/benchmarks/fixtures/sample.csv`                 | `fixture`                 | Browser evidence fixture for table conversion. Tests and browser proof may read it.                |
| `apps/tools/lib/fixtures/table/people.csv`                  | `fixture`                 | Application-owned deterministic table-workflow fixture. Tests may read it.                         |
| `docs/evidence/seo-research/config.csv`                     | `dated advisory evidence` | Frozen pre-#54 SEO research; never an application or verification input.                           |
| `docs/evidence/seo-research/kwr_files.csv`                  | `dated advisory evidence` | Frozen pre-#54 keyword research; revalidate externally before citing.                              |
| `docs/evidence/seo-research/kwr_tools.csv`                  | `dated advisory evidence` | Frozen pre-#54 Tool keyword research; status and engine fields are not current facts.              |
| `docs/evidence/seo-research/r_d.csv`                        | `dated advisory evidence` | Frozen pre-#54 research vocabulary; not product policy.                                            |
| `docs/evidence/seo-research/websites.csv`                   | `dated advisory evidence` | Frozen pre-#54 competitor research; not a current site inventory.                                  |
| `docs/evidence/tool-planning/in-progress-missing-audit.csv` | `dated advisory evidence` | Frozen gap snapshot retained for history; current gaps come from source-derived read models.       |
| `docs/evidence/tool-planning/tools_planner.csv`             | `dated advisory evidence` | Frozen planning export retained with its URLs and notes; never read or written by maintained code. |
| `docs/evidence/tool-planning/veed-io.csv`                   | `dated advisory evidence` | Frozen third-party page research; not Catalog intent or active work.                               |

There are currently no tracked generated CSV projections and no tracked
obsolete operational CSV inputs. Generated projections, if introduced later,
must name one canonical input and a deterministic checked generator before
being added to this table.

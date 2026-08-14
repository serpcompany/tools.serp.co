# Documentation index

This is the index of every durable Markdown document in the repository.
Current guidance describes the current branch and is the source to follow.
Historical and advisory material is evidence at its recorded scope and time;
it must not be treated as current operating truth or active work.

Run `pnpm verify:docs` after adding, moving, or linking documentation. The
retired catch-all `docs/knowledge`, `docs/plans`, and `docs/planner` categories
are rejected. Current guidance belongs beside its owner or in `docs/runbooks`;
dated observations belong in `docs/audits`; advisory inputs belong in
`docs/evidence`; active work belongs in GitHub Issues.

## Current guidance

### Repository maps

- [Agent instruction router](../AGENTS.md)
- [Repository architecture](../ARCHITECTURE.md)
- [Domain glossary](../CONTEXT.md)
- [Repository overview and commands](../README.md)
- [ADR policy and index](./adr/README.md)
- [ADR 0001: Catalog compatibility copy is presentation intent](./adr/0001-catalog-compatibility-copy-is-intent.md)

### Agent and workflow policy

- [Domain documentation convention](./agents/domain.md)
- [Downloader Lander outbound-link policy](./agents/downloader-lander-links.md)
- [GitHub issue tracker convention](./agents/issue-tracker.md)
- [Triage label vocabulary](./agents/triage-labels.md)

### Owned application and package contracts

- [Tools application contract](../apps/tools/README.md)
- [ESLint configuration package](../packages/eslint-config/README.md)
- [TypeScript configuration package](../packages/typescript-config/README.md)

### Runbooks

- [Artifact lifecycle and safe cleanup](./runbooks/artifacts.md)
- [Cloudflare operations](./runbooks/cloudflare.md)
- [Command roles and authority](./runbooks/commands.md)
- [Catalog synchronization](./runbooks/catalog-syncs.md)
- [Golden Journey pilot](./runbooks/golden-journey-pilot.md)

## Historical evidence

These documents preserve observations or completed-work context. Confirm any
reusable claim against current code, current runbooks, and linked GitHub work.

- [Adult downloader API smoke after direct streaming](./audits/adult-downloader-10-url-api-smoke-after-direct-streaming.md)
- [Adult downloader batch scale test](./audits/adult-downloader-batch-10-scale-test.md)
- [Adult downloader competitor public-code audit](./audits/adult-downloader-competitor-code-audit.md)
- [Adult downloader Wave 0 capability report](./audits/adult-downloader-wave-0-capability-report.md)
- [Cloudflare production cutover — 2026-06-20](./audits/cloudflare-production-cutover-2026-06-20.md)
- [Cloudflare route-parity crawl — 2026-06-20](./audits/cloudflare-worker-full-route-crawl.md)
- [Downloader domain-gap audit](./audits/tools-serp-downloader-domain-gap-audit.md)
- [Downloader Lander content-upgrade retrospective](./audits/downloader-lander-content-upgrade-retrospective.md)
- [FFmpeg Tool benchmark — 2026-01-20](./audits/ffmpeg-tools-benchmark-2026-01-20.md)
- [Ignored local workflow inventory — 2026-08-11](./audits/ignored-local-inventory-2026-08-11.md)
- [SVG compression family selection — 2026-08-14](./audits/svg-compression-family-selection-2026-08-14.md)
- [Tool verification and runtime-observation coverage — 2026-08-11](./audits/tool-verification-runtime-coverage-2026-08-11.md)
- [Tool processor expansion-gap evidence — 2026-08-12](./audits/tool-processor-expansion-gap-2026-08-12.md)
- [Retained Tool Journey verification runs](./audits/tool-verification/README.md)
- [Vercel-retirement and Cloudflare-readiness audit](./audits/vercel-retirement-cloudflare-readiness.md)
- [Workflow preview human review packet — 2026-08-12](./audits/workflow-preview-human-review-2026-08-12.md)

## Advisory evidence

Advisory exports can seed new research. They do not establish publication,
capability, correctness, health, or work state.

- [Evidence classification](./evidence/README.md)
- [OSS library and tool research backlog](./evidence/oss-library-research/README.md)
- [Tool-planning exports](./evidence/tool-planning/README.md)
- [SEO research exports](./evidence/seo-research/README.md)

## Authority by concern

| Concern                                    | Canonical owner                                               | Explicitly non-canonical                         |
| ------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------ |
| Published Tool identity and product intent | `packages/app-core/src/data/tools.json`                       | Planning and SEO CSV exports                     |
| Implemented execution path                 | Application processor/Worker modules and execution provenance | Catalog copy or a fixture alone                  |
| Current verified behavior                  | Retained Tool Journey evidence projected by Tool Factory      | Local artifacts, telemetry, and dated audits     |
| Active work, blockers, and decisions       | GitHub Issues with native relationships                       | Repository plan documents and CSV status columns |
| Historical research                        | Dated `docs/audits` and advisory `docs/evidence`              | Current operating guidance                       |

CSV files under `docs/evidence` remain read-only research inputs until an
explicit sync consumes them. Implementations must join on canonical Tool ids
and must not write progress or verification state back into those exports.

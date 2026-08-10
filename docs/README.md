# Documentation index

This is the index of every durable Markdown document in the repository.
Current guidance describes the current default branch and is the source to
follow. Historical and advisory material is evidence at its recorded scope and
time; it must not be treated as current operating truth or active work.

Run `pnpm verify:docs` after adding, moving, or linking documentation. New
documents are not accepted in the retired catch-all `docs/knowledge`,
`docs/plans`, or `docs/planner` categories. Their existing contents are an
explicit migration baseline for GitHub issue #54.

## Current guidance

### Repository maps

- [Agent instruction router](../AGENTS.md)
- [Repository architecture](../ARCHITECTURE.md)
- [Domain glossary](../CONTEXT.md)
- [Repository overview and commands](../README.md)
- [ADR policy and index](./adr/README.md)

### Agent and workflow policy

- [Domain documentation convention](./agents/domain.md)
- [Downloader Lander outbound-link policy](./agents/downloader-lander-links.md)
- [GitHub issue tracker convention](./agents/issue-tracker.md)
- [Triage label vocabulary](./agents/triage-labels.md)

### Operations and maintained contracts

- [Cloudflare operations](./knowledge/cloudflare-operations.md) — current
  Worker, D1, R2, and deployment runbook; retained in a legacy location until
  issue #54 moves it.
- [Format fixture matrix](./fixture-matrix.md)
- [Related Apps section](./related-apps.md)
- [Tool groupings](./tool-groupings.md)
- [ESLint configuration package](../packages/eslint-config/README.md)
- [TypeScript configuration package](../packages/typescript-config/README.md)

## Historical and advisory evidence

Everything in this section is non-authoritative. Confirm any reusable claim
against current code, the current runbooks, and linked GitHub work.

### Dated audits and retrospectives

- [Adult downloader API smoke after direct streaming](./audits/adult-downloader-10-url-api-smoke-after-direct-streaming.md)
- [Adult downloader batch scale test](./audits/adult-downloader-batch-10-scale-test.md)
- [Adult downloader competitor public-code audit](./audits/adult-downloader-competitor-code-audit.md)
- [Adult downloader Wave 0 capability report](./audits/adult-downloader-wave-0-capability-report.md)
- [Cloudflare production cutover — 2026-06-20](./audits/cloudflare-production-cutover-2026-06-20.md)
- [Cloudflare route-parity crawl — 2026-06-20](./audits/cloudflare-worker-full-route-crawl.md)
- [Downloader domain-gap audit](./audits/tools-serp-downloader-domain-gap-audit.md)
- [Vercel-retirement and Cloudflare-readiness audit](./audits/vercel-retirement-cloudflare-readiness.md)
- [Downloader Lander content-upgrade retrospective](./downloader-lander-content-upgrade-retrospective.md)

### Superseded plans and planner material

- [Cloudflare migration plan](./migrate-tools-serp-co-to-cf.md)
- [Adult downloader capability-testing plan](./plans/2026-05-17-adult-downloader-capability-testing-plan.md)
- [Adult downloader competitor-first scale plan](./plans/2026-05-17-adult-downloader-competitor-first-scale-plan.md)
- [Adult downloader scale plan](./plans/2026-05-17-adult-downloader-scale-plan.md)
- [Planner sheet notes](./planner/README.md)
- [PDF Tool research links](./planner/pdf-tools.md)

### Legacy notes awaiting migration or retirement

These files are indexed so they remain discoverable, but their catch-all
location and currentness are not endorsed. Issue #54 owns reconciliation into
an owned runbook/package contract or preservation as dated evidence.

- [AdSense behavior notes](./knowledge/adsense.md)
- [AMR audio conversions](./knowledge/amr-audio-conversion.md)
- [APNG server conversion](./knowledge/apng-image-convert.md)
- [Transcription benchmark notes](./knowledge/benchmark-transcribe-tools.md)
- [Category pages](./knowledge/category-pages.md)
- [Compression pipeline](./knowledge/compression-pipeline.md)
- [Development server ports](./knowledge/dev-server-ports.md)
- [Development server PostCSS recovery](./knowledge/dev-server-postcss.md)
- [Download Loom videos](./knowledge/download-loom-videos.md)
- [Downloader ads](./knowledge/downloader-ads.md)
- [Downloader page requirements](./knowledge/downloader-page-requirements.md)
- [Downloader rate limit](./knowledge/downloader-rate-limit.md)
- [FFmpeg benchmark — 2026-01-20](./knowledge/ffmpeg-benchmark-2026-01-20.md)
- [Office and document fixtures](./knowledge/fixtures-office.md)
- [Image canvas grouping](./knowledge/image-canvas-grouping.md)
- [JSquash WebP Next.js build note](./knowledge/jsquash-webp-next-build.md)
- [Next lint deprecation note](./knowledge/lint-next-lint-deprecation.md)
- [PDF viewer/editor MVP](./knowledge/pdf-viewer-editor.md)
- [Server Action rate limit](./knowledge/server-action-rate-limit.md)
- [Shared site footer](./knowledge/shared-site-footer.md)
- [Tool operation taxonomy](./knowledge/tool-operation-taxonomy.md)
- [Tools link hub](./knowledge/tools-link-hub.md)
- [Legacy Tools SOP](./tools-sop.md)

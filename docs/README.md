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

- [Cloudflare operations](./runbooks/cloudflare.md)

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
- [Vercel-retirement and Cloudflare-readiness audit](./audits/vercel-retirement-cloudflare-readiness.md)

## Advisory evidence

Advisory exports can seed new research. They do not establish publication,
capability, correctness, health, or work state.

- [Evidence classification](./evidence/README.md)
- [Tool-planning exports](./evidence/tool-planning/README.md)
- [SEO research exports](./evidence/seo-research/README.md)

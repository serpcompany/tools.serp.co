# Downloader domain-gap audit

Historical advisory evidence only.

- Observed: 2026-05-18
- Revision: `373c3fbf50a623c74f866fde31999d2260ce9432`
- Source provenance: the repository Tool registry was compared with three
  locally generated competitor/domain research exports from an unversioned
  personal sibling checkout; the external exports were not retained
- Scope: 6,837 normalized domains were compared with the 79 active downloader
  Tools present at the recorded revision
- Limitations: the authority, collection method, raw rows, and sample pages are
  not portable or reproducible; classifications and counts are advisory and do
  not establish current catalog intent, capability, priority, or work state

## Decision-grade findings

At the recorded revision, the comparison classified 60 researched domains as
covered by an active downloader page and 6,777 as missing. The local adult label
export marked 1,292 of the missing domains as adult. These counts demonstrated
that the research space was much larger than the maintained Tool catalog and
that bulk generation from competitor observations would be unsafe.

The generated CSV reports, personal-path runner, and per-domain recommendations
were retired. New Tool proposals must start from a portable named authority,
use registry Tool ids, and be tracked in GitHub Issues. This audit is retained
only to explain why the old bulk research path was not made canonical.

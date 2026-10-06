# Adult downloader competitor public-code audit

Historical evidence only.

- Observed: 2026-05-18
- Revision: `373c3fbf50a623c74f866fde31999d2260ce9432`
- Source provenance: public competitor pages, browser JavaScript, documented
  HTTP interfaces, and public repository material inspected at the time; raw
  captures and third-party source copies were not retained
- Scope: a bounded review of whether public competitor clients exposed reusable
  downloader implementation patterns, with Tube8 used as one probe target
- Limitations: services, endpoints, terms, code, and licenses can change; no
  license or privacy review was completed, so no third-party code or captured
  sample is approved for reuse

## Decision-grade findings

- Most competitors kept extraction logic server-side. Public clients exposed
  request shapes, result pages, tokens, or fallback links rather than a complete
  extractor implementation.
- Several Tube8-branded flows redirected to a third-party fallback instead of
  returning direct media. A templated landing page alone was not evidence of a
  working extractor.
- One public browser-extension project illustrated the general value of a
  privileged browser client for header-sensitive downloads, but its code was
  not cleared for reuse.
- A tested public API appeared to use `yt-dlp`, which reinforced the local
  direct-URL extraction experiment; later authorization failures showed that a
  competitor endpoint was not a stable dependency.

These observations may inform a new, licensed design investigation. They must
not be treated as current availability, an integration contract, or permission
to copy third-party code.

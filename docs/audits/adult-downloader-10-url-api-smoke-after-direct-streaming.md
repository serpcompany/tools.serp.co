# Adult downloader API smoke after direct streaming

Historical evidence only.

- Observed: 2026-05-18
- Revision: `373c3fbf50a623c74f866fde31999d2260ce9432`
- Source provenance: a locally assembled set of ten public adult-video page
  URLs and responses from a local `media-fetch` API instance; raw inputs and
  response artifacts were not retained
- Scope: one bounded API smoke after the media-fetch path changed from full
  temporary downloads to direct media streaming
- Limitations: source availability, extractor behavior, response content, and
  the input selection were time-dependent; this is not reproducible evidence
  and does not establish current Tool health

## Decision-grade finding

Five of ten requests began returning media bytes within a 25-second cap. The
other five exposed a mix of unsupported URLs, extraction failures, and an
anti-bot response. A second seven-URL batch began streaming three responses.

The result supported keeping direct URL extraction as the preferred server
path at that revision. It did not justify a durable per-site capability claim.
Current behavior must be verified through the maintained canary and browser
commands with an explicitly supplied, authorized input.

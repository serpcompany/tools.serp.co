# Adult downloader batch scale test

Historical evidence only.

- Observed: 2026-05-18
- Revision: `373c3fbf50a623c74f866fde31999d2260ce9432`
- Source provenance: rows 11–20 of a locally generated downloader-domain
  research export plus live public pages; the source export and generated
  results were not retained
- Scope: sample discovery, extractor probing, and local API behavior for ten
  then-candidate adult-video domains
- Limitations: only seven sample pages were discovered, all observations were
  network- and time-dependent, and the unretained inputs make the run
  non-reproducible; no current capability or health claim follows

## Decision-grade finding

Discovery found candidate pages for seven of ten domains. Three of those seven
reported formats through `yt-dlp`, but none returned response headers through
the then-current API within twelve seconds. The bottleneck was consistent with
the API downloading a complete media file before responding.

This run motivated testing a direct-media streaming path. It is not a fixture,
supported-site list, or maintained verification command.

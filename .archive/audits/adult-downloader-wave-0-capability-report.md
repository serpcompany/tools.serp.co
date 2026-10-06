# Adult downloader Wave 0 capability report

Historical evidence only.

- Observed: 2026-05-18
- Revision: `373c3fbf50a623c74f866fde31999d2260ce9432`
- Source provenance: ten rows selected from local downloader-domain research;
  only the Tube8 row had a verified public sample at run time, and the raw input
  and output files were not retained
- Scope: an initial capability probe for ten candidate source domains
- Limitations: nine rows were not actually exercised; missing samples meant
  unknown evidence, not failure, and the sole positive observation is stale and
  non-reproducible

## Decision-grade finding

The Tube8 sample exposed four MP4 variants through a page-specific
`mediaDefinition` path, and a HEAD request succeeded for the selected media at
the recorded time. The other nine rows remained untested because no verified
sample was available.

The positive Tube8 observation justified an implementation experiment at that
revision. It does not establish present support. The tracked generated
capability manifest and its application runner were retired because they
collapsed a dated observation into apparent catalog truth.

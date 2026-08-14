# SVG compression family selection — 2026-08-14

Issue: [#134](https://github.com/serpcompany/tools.serp.co/issues/134)

This is dated selection evidence. The Tool Catalog, processor registry, Tool
Journeys, and retained verification evidence remain the current operational
sources of truth.

## Decision

**Continue** with one exact Tool: `compress-svg`, using a dedicated browser
Worker and pinned `svgo@4.0.2`.

The fixed selection membership is:

- Tool IDs: `compress-svg`
- Membership SHA-256:
  `sha256:de4005760206a72b1376ddab4c1021387771ff13063f3ce2027081a548a2c62a`
- Catalog route: `/compress-svg`
- Transformation: SVG to SVG

This selection does not register a processor or change supported counts. The
baseline at revision `a9b6949e8286574f7600225d35b5cbfcb231743b` is 436
supported, 2,368 explicitly unsupported, 0 unwired, and 3 unknown Tools.

## Comparison

| Candidate | Strengths | Main cost or uncertainty | Decision |
| --- | --- | --- | --- |
| `compress-svg` with SVGO 4.0.2 | Official browser entry, MIT license, active maintenance, extensive upstream tests, existing direct dependency, deterministic text-in/text-out semantics | Synchronous API has no `AbortSignal`; SVGO is an optimizer rather than a sanitizer | **Continue** with one Worker-owned Tool |
| `tif-to-png` / `tiff-to-png` with geotiff.js 3.0.5 | Browser build, Worker pool, abort support, active maintenance | Larger dependency and decompression/memory attack surface; non-Geo TIFF coverage needs proof | Hold as a later image-family candidate |
| `csv-to-toml` / `markdown-to-toml` with smol-toml 1.8.0 | Small, zero runtime dependencies, upstream conformance coverage | Browser/Worker support is not an explicit upstream contract; output shape is a product decision | Hold pending product contract |
| JXL family with `@jsquash/jxl` | Explicit browser and Worker use | Large codec surface, older package, termination-only cancellation, weak independent browser oracle | Reconsider for now |
| PSD family with `ag-psd` | Active and documents browser-Worker use | Very large parser surface and recently repaired memory-allocation advisories | Reconsider for now |

The parked HEIF and repository-authored table-raster approaches remain excluded.
Neither comparison produced a materially safer maintained decoder or a broad,
bounded table renderer.

## Why SVGO, with constraints

SVGO publishes an official [`svgo/browser` entry](https://svgo.dev/docs/usage/browser/)
and upstream browser tests. It is already a direct dependency of the Tools app,
so this proof can deepen the existing shared Tool workflow without introducing
a new codec runtime.

The repository currently requests `svgo@^4.0.1`. Implementation must upgrade
and pin 4.0.2 before processing user input. The
[4.0.2 release](https://github.com/svg/svgo/releases/tag/v4.0.2) repairs
script and JavaScript-URI bypasses described in
[GHSA-2p49-hgcm-8545](https://github.com/svg/svgo/security/advisories/GHSA-2p49-hgcm-8545).
Version 4.0.1 previously repaired an entity-expansion denial of service in
[GHSA-xpqw-6gx7-v673](https://github.com/svg/svgo/security/advisories/GHSA-xpqw-6gx7-v673).
These fixes reinforce that SVGO must not be treated as an SVG sanitizer.

The production proof should therefore use this bounded contract:

- accept one UTF-8 SVG file, with a 1 MiB input and output ceiling;
- reject DOCTYPE/entity declarations, scripts, event-handler attributes,
  JavaScript URLs, and external resource URLs before optimization;
- enforce at most 10,000 elements, nesting depth 64, and 50,000 attributes;
- run one optimization pass in a dedicated owned Worker, with a 10-second
  deadline;
- terminate the Worker on abort or timeout, clean up exactly once, and suppress
  every late result or delivery;
- require well-formed inert SVG output and never claim compression when output
  is not smaller; return an honest unchanged/no-op result instead;
- independently render input and output at two bounded viewport sizes and
  compare dimensions, visible pixels, and referenced-ID behavior within a
  documented tolerance.

Owned fixtures must cover paths, gradients, clipping or masks, ID references,
Unicode text, namespaces, an already-minimal no-op, malformed and truncated
input, DOCTYPE/entities, active or external content, complexity limits,
timeout, and cancellation. Preview evidence must prove actual Worker loading,
semantic equivalence, deterministic output, malformed/spoofed/wrong-output
rejection, no delivery on failure, cancellation cleanup, and suppression of
late delivery.

## One source-of-truth path

The implementation must consume the exact Tool ID from the canonical Tool
Catalog and must not read or update advisory planning CSVs. Processor
availability belongs to the processor registry; behavior belongs to the Tools
app; journey identity belongs to Tool Journeys; retained facts belong to Tool
verification evidence; active work belongs to GitHub Issues. Supported counts
must remain derived projections rather than manually edited targets.

Issue [#135](https://github.com/serpcompany/tools.serp.co/issues/135) tracks the
separate removal of remaining operational reads and writes of advisory Tool
planning CSVs.

## Primary sources

- [SVGO browser usage](https://svgo.dev/docs/usage/browser/)
- [SVGO 4.0.2 release](https://github.com/svg/svgo/releases/tag/v4.0.2)
- [SVGO browser test](https://github.com/svg/svgo/blob/main/test/browser.js)
- [SVGO default preset](https://svgo.dev/docs/preset-default/)
- [geotiff.js documentation](https://geotiffjs.github.io/geotiff.js/)
- [smol-toml repository](https://github.com/squirrelchat/smol-toml)
- [jSquash repository](https://github.com/jamsinclair/jSquash)
- [ag-psd repository](https://github.com/Agamnentzar/ag-psd)

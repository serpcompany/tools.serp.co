# TIFF-to-PNG family selection — 2026-08-15

This is dated selection evidence for the next maintained-library-first,
client-only Tool slice after `compress-svg`. The Tool Catalog, processor
registry, Tool Journeys, and retained verification evidence remain the current
operational sources of truth.

## Decision

**Continue** with exactly two alias Tools, `tif-to-png` and `tiff-to-png`,
using a dedicated browser Worker and pinned `geotiff@3.0.5` for the untrusted
TIFF decode. Reuse the repository's bounded PNG encoder and validate the PNG
through an independent browser decode before delivery.

The fixed selection membership is:

- Tool IDs: `tif-to-png`, `tiff-to-png`
- Membership SHA-256:
  `sha256:7f1420b62963f2627681c66dce42b4e60d4eed43884490a3256655ce74f522f7`
- Catalog routes: `/tif-to-png`, `/tiff-to-png`
- Transformation: one accepted TIFF raster to one pixel-preserving PNG image

The hash is SHA-256 over the JSON encoding of the sorted Tool-ID array. This
selection does not install a dependency, register a processor, change Catalog
intent, or change supported counts.

At exact revision `714dd1b0d5923ea5f8a88377a4b4036781542a77`, the canonical
projection is 437 supported, 2,367 explicitly unsupported, 0 unwired, and 3
unknown Tools. Both selected Tools are explicitly unsupported. Their current
projection maps them to the server-image dispatch but records no production
adapter, no exact semantic-verifier contract, and no runtime proof. The proposed
slice replaces that unproved server path with browser-owned execution; it does
not treat the dispatch mapping as implementation evidence.

## Bounded comparison

| Candidate                                               | Exact unsupported membership                                                                                  | Maintained-library and runtime evidence                                                                                         | Main blocker or cost                                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TIFF/TIF to PNG with `geotiff@3.0.5`                    | `tif-to-png`, `tiff-to-png` (`sha256:7f1420b62963f2627681c66dce42b4e60d4eed43884490a3256655ce74f522f7`)       | Current stable release on 2026-03-11; MIT; explicit browser export, local `ArrayBuffer` input, raster/RGB APIs, and Worker pool | Eight runtime dependencies and a 3.83 MB unpacked package; decoder allocation and cancellation must be owned outside the library                                                               |
| Table data to TOML with `smol-toml@1.8.0`               | `csv-to-toml`, `markdown-to-toml` (`sha256:60036d223e5793107beba834d466d86edfefc876904a7af0fbeb7f507eca3345`) | Released 2026-08-11; BSD-3-Clause; zero runtime dependencies; ESM/CJS serializer and upstream TOML conformance suite            | A TOML document cannot be an anonymous top-level row array, so the required root key and scalar/type coercion are product semantics, not library choices                                       |
| APNG to GIF with existing `upng-js` plus `gifenc@1.0.3` | `apng-to-gif` (`sha256:7560ab266247e44cc7cfb66f441042b096405a959668561ff6c39041d78386f6`)                     | Both are MIT; `gifenc` documents browsers, animated GIFs, and Web Worker use; the repository already carries `upng-js`          | `gifenc@1.0.3` was published in 2021 and `upng-js@2.1.0` in 2017; frame timing, disposal, transparency, palette loss, and total-frame allocation make this a wider semantic and resource proof |

The TIFF slice is the only recommendation in this report. The TOML candidate is
technically attractive but needs an explicit table-to-document mapping before
implementation. APNG-to-GIF needs a maintained decode/encode pair or materially
stronger dependency evidence. Parked HEIF and table-raster work were not
reconsidered because this research found no materially new evidence that closes
their recorded blockers.

### Cross-candidate evidence

`smol-toml@1.8.0` is the smallest and most recently released candidate. Its npm
artifact is 23,162 compressed bytes and 109,164 unpacked bytes across 19 files,
with no runtime dependencies. Its package exports ESM and CommonJS and its
distributed ESM has no Node built-in imports, but upstream does not declare or
test a browser-Worker support contract. Cancellation would therefore still be
owned by a dedicated Worker. More importantly, the serializer accepts a root
object while the two Catalog Tools begin with an ordered table of rows. TOML
supports named tables and arrays of tables, so a choice such as `rows = [...]`
is feasible and round-trip validation is strong, but the root name, duplicate
headers, empty cells, numeric/boolean/date inference, and ordering rules must be
specified before code can prove the promised conversion. The upstream project
documents the precise JavaScript integer/date conformance exceptions, which
would also need acceptance tests.

The APNG-to-GIF slice is browser-feasible: `gifenc` explicitly documents ESM,
browsers, animated frames, transparency, and an example that distributes frame
encoding across Web Workers. It has no runtime dependencies and its npm artifact
is 43,036 compressed bytes and 172,516 unpacked bytes. The existing
`upng-js@2.1.0` artifact is 11,656 compressed bytes and 36,406 unpacked bytes,
plus its `pako` dependency. Neither codec exposes native cancellation, so an
owned Worker would be the boundary. Exact semantic validation must retain APNG
frame count, dimensions, duration, disposal, blending, and alpha intent after a
lossy 256-color GIF mapping; a decodable first frame is insufficient. This is a
substantially wider contract than one lossless TIFF raster to one PNG.

GitHub's reviewed npm advisory query returned no exact direct-package match for
`geotiff@3.0.5`, `smol-toml@1.8.0`, `gifenc@1.0.3`, or
`upng-js@2.1.0` on 2026-08-15; the resolved `pako@1.0.11` query was also empty.
This is advisory-database evidence only. It does not compensate for `gifenc`'s
2021 npm release, `upng-js`'s 2017 npm release, or any parser's hostile-input
surface.

## Why geotiff.js is credible, but not sufficient by itself

The `geotiff` package owns an explicit browser export and accepts local
`ArrayBuffer` or `Blob` inputs. Its image API exposes dimensions before raster
allocation and supports stripped, tiled, planar, and interleaved rasters,
multiple sample types, and the common uncompressed, PackBits, LZW, Deflate,
JPEG, LERC, Zstandard, and browser-decoded compression paths. `readRGB()`
normalizes supported photometric interpretations to RGB and passes an
`AbortSignal` through raster reads.

Version 3.0.5 is the current stable release recorded by npm and GitHub. The npm
artifact declares MIT, eight runtime dependencies, a 970,842-byte tarball, and
3,829,334 unpacked bytes. The distributed all-in browser build measures 550,900
raw bytes and 199,941 bytes with gzip level 9. Those are package-artifact
measurements, not a claim about the final Next.js worker chunk; the implementation
gate must record the actual production worker chunk and prove that the dependency
is loaded only on these exact routes.

The upstream `Pool` can create Web Workers and has an explicit `destroy()` API,
but its decode jobs do not accept an `AbortSignal`. Signals can stop or reject
source reads; they do not prove that a CPU-bound decompressor has stopped. The
repository should therefore run geotiff.js inside one owned dedicated Worker,
avoid a nested geotiff pool, terminate the outer Worker on abort or deadline,
settle cleanup exactly once, and suppress all late progress and delivery. The
browser Worker API specifies that `terminate()` immediately stops the worker;
that is the hard cancellation boundary.

The GitHub Advisory Database returned no reviewed npm advisory matching
`geotiff@3.0.5` on 2026-08-15, and an isolated `npm audit` of that package and
its resolved production tree returned zero known vulnerabilities. Absence of a
published advisory is not decoder-safety proof. TIFF offsets, strip/tile counts,
compression ratios, sample widths, and dimensions are attacker-controlled, so
preflight limits and worker termination remain mandatory.

## Required implementation and proof contract

The next implementation issue should preserve the existing shared workflow and
use this bounded contract:

- accept one classic TIFF/TIF file with supported 8-bit integer color/sample
  layouts locally and reject extension-only or MIME-only matches before decode;
- reject BigTIFF, floating-point or higher-bit-depth samples, and unsupported
  photometric layouts honestly until each has an explicit pixel-normalization
  contract and fixtures;
- make multi-image behavior explicit and lossless: reject a TIFF containing
  more than one image rather than silently discarding pages from a singular-PNG
  Tool;
- enforce a per-family 32 MiB input ceiling (matching the specialized workflow
  default), the existing 16,384 maximum dimension and 64 MiB decoded-RGBA
  ceiling, and a 64 MiB output ceiling before every material allocation where
  metadata permits;
- run decode and PNG encode inside one lazy, route-scoped dedicated browser
  Worker with a 10-second deadline;
- use geotiff.js without its nested pool, terminate the owned Worker on abort or
  timeout, clean up exactly once, and never deliver after failure or cancellation;
- require a valid PNG signature, IHDR dimensions equal to the accepted TIFF
  dimensions, bounded output size, and a successful independent browser decode;
- compare independently decoded output RGBA with the geotiff.js source raster
  exactly for opaque pixels and under a documented unpremultiplied-alpha
  contract; reject unsupported photometric/sample layouts honestly instead of
  relabeling or approximating;
- keep the two alias Tool Journeys exact: neither journey may borrow positive or
  negative evidence from the other.

Owned fixtures should cover little- and big-endian TIFF, stripped and tiled
storage, RGB, grayscale, palette, alpha, representative supported compressions,
and the accepted 8-bit sample layouts. Negative fixtures must include an
extension spoof, wrong magic, truncated header/IFD/strip, invalid offsets and
byte counts, oversized dimensions, decompression expansion, BigTIFF,
higher-bit-depth and floating samples, unsupported photometric/sample layouts,
and a multi-image TIFF. Preview proof must also cover deterministic output,
wrong-output rejection, no delivery on failure, cancellation during decode and
encode, timeout cleanup, late-message suppression, actual browser Worker
loading, actual emitted worker-chunk cost, and both exact routes.

Only after those tests, an exact preview deployment, browser journeys, semantic
checks, and retained evidence pass should the processor registry or supported
projection change. No Cloudflare Worker-side conversion is selected: the
deployed Worker serves the application and lazy browser asset, while user bytes
remain in the browser.

## Reproduction

Run from the repository root at the recorded revision with Node 22:

```sh
mise exec node@22.23.1 -- pnpm --silent audit:tool-coverage -- --source-revision 714dd1b0d5923ea5f8a88377a4b4036781542a77 --format json
mise exec node@22.23.1 -- pnpm --silent audit:tool-expansion-gap -- --source-revision 714dd1b0d5923ea5f8a88377a4b4036781542a77 --format json
npm view geotiff@3.0.5 version time dist.unpackedSize license dependencies --json
npm pack geotiff@3.0.5 --json
gh api '/advisories?ecosystem=npm&affects=geotiff@3.0.5&per_page=100'
gh api '/advisories?ecosystem=npm&affects=smol-toml@1.8.0&per_page=100'
gh api '/advisories?ecosystem=npm&affects=gifenc@1.0.3&per_page=100'
gh api '/advisories?ecosystem=npm&affects=upng-js@2.1.0&per_page=100'
```

The package tarball measurements above come from the `npm pack` artifact. The
gzip measurement is `gzip -c -9 package/dist-browser/geotiff.js | wc -c` after
extracting that exact artifact.

## Primary sources

- [Canonical Tool Catalog](../../packages/app-core/src/data/tools.json)
- [Current processor registry](../../apps/tools/lib/tool-processor-registry.ts)
- [Current generic Tool contract](../../apps/tools/lib/generic-tool-workflow.ts)
- [Current image-allocation limits](../../apps/tools/lib/tool-workflow/image-allocation-limits.ts)
- [geotiff.js 3.0.5 release](https://github.com/geotiffjs/geotiff.js/releases/tag/v3.0.5)
- [geotiff.js documentation](https://geotiffjs.github.io/geotiff.js/)
- [geotiff.js 3.0.5 package manifest](https://github.com/geotiffjs/geotiff.js/blob/v3.0.5/package.json)
- [geotiff.js 3.0.5 raster and RGB implementation](https://github.com/geotiffjs/geotiff.js/blob/v3.0.5/src/geotiffimage.js)
- [geotiff.js 3.0.5 Worker pool implementation](https://github.com/geotiffjs/geotiff.js/blob/v3.0.5/src/pool.js)
- [geotiff.js license](https://github.com/geotiffjs/geotiff.js/blob/v3.0.5/LICENSE)
- [GitHub Advisory Database query for geotiff 3.0.5](https://github.com/advisories?query=ecosystem%3Anpm+affects%3Ageotiff%403.0.5)
- [HTML Worker termination specification](https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate-dev)
- [smol-toml 1.8.0 release](https://github.com/squirrelchat/smol-toml/releases/tag/v1.8.0)
- [smol-toml package and conformance notes](https://github.com/squirrelchat/smol-toml/tree/v1.8.0)
- [smol-toml 1.8.0 package manifest](https://github.com/squirrelchat/smol-toml/blob/v1.8.0/package.json)
- [TOML 1.1.0 specification](https://toml.io/en/v1.1.0)
- [gifenc source, browser/Worker contract, and license](https://github.com/mattdesl/gifenc)
- [gifenc package manifest](https://github.com/mattdesl/gifenc/blob/main/package.json)
- [UPNG.js source and package history](https://github.com/photopea/UPNG.js)

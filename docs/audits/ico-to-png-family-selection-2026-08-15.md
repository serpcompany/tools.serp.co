# ICO-to-PNG family selection — 2026-08-15

This is dated selection evidence for the next maintained-library-first,
client-only Tool slice after `tif-to-png` and `tiff-to-png`. The Tool Catalog,
processor registry, Tool Journeys, and retained verification evidence remain the
current operational sources of truth.

## Decision

**Continue** with exactly `ico-to-png`, using pinned `icojs@1.0.0` in one
dedicated browser Worker and an explicit singular-output rule.

The fixed selection membership is:

- Tool ID: `ico-to-png`
- Membership SHA-256:
  `sha256:2e8404b30c9b954d51d697be77e5e3bc6faf8c9b3a5e942cfb75e56e86d4986e`
- Catalog route: `/ico-to-png`
- Transformation: one valid ICO container to one selected, pixel-preserving PNG

The hash is SHA-256 over the JSON encoding of the sorted Tool-ID array. This
selection does not install a dependency, register a processor, change Catalog
intent, or change supported counts.

At exact revision `3baf61f06e7db9a5c3b1ea95cbfd1111eb495765`, the canonical
expansion projection is 439 supported, 2,365 explicitly unsupported, 0 unwired,
and 3 unknown Tools. `ico-to-png` is explicitly unsupported. It maps to the
browser-raster dispatch but has no registered exact processor or semantic
validator contract.

## Three exact one-Tool candidates

| Candidate                            | Exact unsupported membership                                                              | Browser and maintenance evidence                                                                                                                                 | Main cost or uncertainty                                                                                                                                                         | Decision                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| ICO to PNG with `icojs@1.0.0`        | `ico-to-png` (`sha256:2e8404b30c9b954d51d697be77e5e3bc6faf8c9b3a5e942cfb75e56e86d4986e`)  | MIT; released 2026-05-13 with npm provenance; explicit browser export; browser decode tests in Chromium, Firefox, and WebKit; bounded 256-pixel ICO image domain | Five direct dependencies and 18 resolved production packages; decoder returns every embedded rendition; one upstream 32-bit BMP fixture has Firefox/Safari pixel-test exceptions | **Continue with fixed contract** |
| AVIF to PNG through browser decode   | `avif-to-png` (`sha256:b3da3db87348904ded85a2772096c11e85f1224bbb86d823e3373d2e23a19895`) | AVIF has Web Platform Tests and platform decoders can run through Worker-capable image APIs                                                                      | Animation/sequence policy, ISO BMFF preflight, support gating, color semantics, and an independent decode oracle remain wider than the ICO slice                                 | Hold                             |
| Inert SVG to PNG with browser raster | `svg-to-png` (`sha256:977235de7293cbf3090500c41f42bd38ec3b0e1e4cadfcdfd000fd0dc2cc1058`)  | Existing pinned `svgo@4.0.2`, owned SVG rejection rules, and browser render-verification code provide reusable prerequisites                                     | Intrinsic size, viewport, font, external-reference, color, and cross-browser rasterization semantics require a separate rendering contract                                       | Hold                             |

Parked HEIF, APNG-to-GIF, AVIF encoding, table raster, and table-to-TOML work
were not reconsidered; this research found no materially new evidence that
resolves their recorded blockers.

## Why `icojs@1.0.0` is credible

The exact npm release was published on 2026-05-13 from upstream commit
`2e90fc380d7ce6a517c599919eac4427ac08276c`. The artifact is MIT licensed,
provenance-attested, 114,773 unpacked bytes, and exposes a conditional browser
entry plus an explicit `icojs/browser` export. Its browser implementation uses
`Blob`, `createImageBitmap`, `OffscreenCanvas`, and `ImageData`, so it fits a
dedicated Worker without DOM ownership. Upstream CI installs Playwright and runs
the browser suite in Chromium, Firefox, and WebKit. The suite covers multi-image
ICO, palette images, PNG-backed images, BMP-backed depths from 1 through 32 bits,
and CUR; the production Tool must reject CUR rather than inheriting that wider
library capability.

The browser suite also documents an important qualification: it skips the pixel
assertion for one 32-bit BMP-backed fixture in Firefox and Safari while still
checking the decoded metadata and output type. That is not a security or runtime
blocker, but upstream compatibility alone is insufficient. Our acceptance suite
must use fixed expected PNG fixtures and the repository's existing
`sharp@0.34.5` as an independent test-only decoder/pixel oracle across the
supported preview browsers, with a documented zero-or-small channel tolerance.

`decodeIco` preserves directory order and returns an array containing every
embedded image. For PNG-backed entries it returns the embedded PNG bytes; for
BMP/DIB entries it converts decoded RGBA through `OffscreenCanvas`. It has no
`AbortSignal`, entry-count ceiling, aggregate-pixel ceiling, or singular-image
selection API. Those are intentionally owned by the Tool adapter and Worker,
not inferred from the library.

## Exact dependency, bundle, license, and advisory posture

`icojs@1.0.0` declares five direct runtime dependencies: `bmp-ts@^1.0.9`,
`decode-ico@^0.4.1`, `file-type@^22.0.1`, `jpeg-js@^0.4.4`, and
`pngjs@^7.0.0`. A fresh lock on 2026-08-15 resolved 18 production packages
including `icojs` (19 `node_modules` paths including the application root).
Every resolved package declares MIT or BSD-3-Clause. An isolated
`npm audit --omit=dev` returned zero known vulnerabilities. Exact GitHub
Advisory Database queries were empty for `icojs`, all five direct dependencies,
and all twelve additional resolved transitives. This is current database
evidence, not proof that hostile image input is safe.

The full installed dependency tree occupied about 2.0 MiB on disk. The exact
artifact's all-in UMD browser build is 8,630 raw bytes and 3,161 gzip bytes; it
bundles the ICO/DIB decode and browser conversion path. The ESM browser entry
also exports encoding, so implementation must import only `decodeIco`, keep the
dependency lazy and Worker-only, and record the actual emitted production Worker
chunk. Acceptance fails if encoder-only `bmp-ts`, `file-type`, `jpeg-js`, or
`pngjs` code leaks into that chunk or any unrelated route. Package and UMD sizes
are planning measurements, not claims about the final Next.js asset.

The dependency graph includes older, narrower decoders (`decode-ico@0.4.1` from
2022, `jpeg-js@0.4.4` from 2022, and `pngjs@7.0.0` from 2023), even though the
top-level package is actively maintained. The selected browser decode path is
primarily `decode-ico` plus its `decode-bmp` tree; the five-direct-dependency
inventory must nevertheless remain pinned, reviewed, and visible in the lock.
No advisory finding may be waived merely because bundling appears to omit the
affected package.

## Singular-output and semantic contract

ICO files deliberately contain multiple device images at different dimensions
and color depths. Microsoft documents both the multi-image design and the normal
selection behavior: an exact requested size is preferred, otherwise a larger
image can be scaled down. This converter has no requested target size, so it
must not silently choose the library's first result or produce a ZIP.

The fixed first-slice rule is: validate every directory entry, then select the
entry with greatest `width * height`; break equal-area ties by greatest decoded
bits per pixel; break remaining ties by lowest original directory index. Return
exactly that rendition as PNG without resizing. This favors the greatest source
resolution and fidelity while remaining deterministic and preserving stable
file order. The UI and Tool Journey must state that one highest-resolution image
is extracted. A later target-size selector would be a separate product change.

Before decode, require reserved word 0, resource type 1 (ICO, not CUR), at least
one and at most 64 directory entries, bounded non-overlapping entry ranges, and
valid PNG or DIB payload signatures. Treat directory width or height byte 0 as
256, as Microsoft's icon directory definition requires. Require embedded PNG
IHDR/DIB dimensions to agree with the directory entry, dimensions from 1 through
256, supported bit depths, and an aggregate decoded allocation no larger than
16 MiB. Reject malformed offsets, overlaps, inconsistent metadata, unsupported
compression, and entries whose decoded metadata disagrees with the validated
directory rather than guessing.

The first implementation should enforce a 16 MiB input ceiling, 64-entry
ceiling, 256 maximum dimension, 16 MiB aggregate decoded-RGBA ceiling, 4 MiB
selected PNG ceiling, and 10-second deadline. These are fail-closed initial
bounds. Because `decodeIco` maps all entries through `Promise.all`, checking the
aggregate before importing or calling it is mandatory; selecting after an
unbounded decode is not a resource control.

## Worker, cancellation, and output proof

Run the whole preflight, dynamic import, decode, selection, and PNG verification
inside one lazy route-scoped dedicated Worker. The library has no cancellation
API. Abort, replacement, or deadline must therefore terminate the Worker,
release it exactly once, and invalidate the request ID. The shared workflow must
suppress every late progress message, result, object URL, and download after a
terminal outcome. HTML specifies `Worker.terminate()` as immediately terminating
the worker; that is the hard CPU and allocation boundary.

Before delivery, require a valid PNG signature and bounded chunk walk, exactly
one IHDR, dimensions equal to the selected entry, non-empty IDAT, IEND, and no
trailing ambiguity. Independently decode the output through the supported
browser image path and verify dimensions. For PNG-backed ICO entries, compare
decoded output RGBA with an independent decode of the bounded embedded PNG. For
BMP/DIB-backed entries, contract tests and preview journeys must compare against
fixed expected PNGs using `sharp`, not another call through `icojs` or
`decode-ico`. Record the pixel tolerance by browser; the upstream Firefox/Safari
exception cannot become an unmeasured blanket waiver.

Fixtures must cover one- and multi-image ICOs, out-of-order sizes, equal-area
and equal-depth ties, 1/4/8/24/32-bit DIB entries, alpha masks, palette images,
PNG-backed 256-pixel images, and non-square entries. Negative fixtures must
cover CUR, wrong magic, zero/excessive count, truncated directory/payload,
overflowing or overlapping offsets, dimension disagreement, unsupported DIB
compression/depth, spoofed PNG, oversized input/aggregate/output, and corrupt
alpha masks. Lifecycle tests must cover cancellation before import and during
decode, timeout termination, replacement by a newer run, one terminal cleanup,
and late-delivery suppression. Preview evidence must prove the actual Worker
asset, exact route, deterministic selection, emitted chunk size, independent
pixel checks in each supported browser, and no user-byte upload.

Only after those red-green tests, preview browser journeys, semantic checks, and
retained evidence pass should the processor registry or supported projection
change. The Cloudflare Worker serves the application and lazy browser asset;
user bytes remain in the browser.

## Reproduction

Run from the repository root at the recorded revision with Node 22:

```sh
mise exec node@22.23.1 -- pnpm --silent audit:tool-expansion-gap -- --source-revision 3baf61f06e7db9a5c3b1ea95cbfd1111eb495765 --format json
npm view icojs@1.0.0 --json
npm pack icojs@1.0.0 --json --dry-run
npm install --package-lock-only --ignore-scripts --omit=dev icojs@1.0.0
npm audit --omit=dev --json
gh api '/advisories?ecosystem=npm&affects=icojs@1.0.0&per_page=100'
```

The dependency count and audit came from a fresh temporary package. The
membership hashes are SHA-256 over each candidate's JSON-encoded sorted Tool-ID
array. The UMD measurement is from `dist/ico.js` in the exact npm tarball, with
gzip's default compression.

## Primary sources

- [Canonical Tool Catalog](../../packages/app-core/src/data/tools.json)
- [Current processor registry](../../apps/tools/lib/tool-processor-registry.ts)
- [Current conversion dispatch](../../apps/tools/lib/convert/conversion-dispatch.ts)
- [Current image allocation limits](../../apps/tools/lib/tool-workflow/image-allocation-limits.ts)
- [Tools app dependency manifest](../../apps/tools/package.json)
- [`icojs` 1.0.0 release](https://github.com/egy186/icojs/releases/tag/v1.0.0)
- [`icojs` 1.0.0 package manifest and browser exports](https://github.com/egy186/icojs/blob/2e90fc380d7ce6a517c599919eac4427ac08276c/package.json)
- [`icojs` browser decode implementation](https://github.com/egy186/icojs/blob/2e90fc380d7ce6a517c599919eac4427ac08276c/src/browser/image.ts)
- [`icojs` multi-image decode implementation](https://github.com/egy186/icojs/blob/2e90fc380d7ce6a517c599919eac4427ac08276c/src/decode.ts)
- [`icojs` cross-browser tests and documented exceptions](https://github.com/egy186/icojs/blob/2e90fc380d7ce6a517c599919eac4427ac08276c/src/browser/index.test.ts)
- [`icojs` Chromium, Firefox, and WebKit test configuration](https://github.com/egy186/icojs/blob/2e90fc380d7ce6a517c599919eac4427ac08276c/vitest.config.ts)
- [`icojs` CI workflow](https://github.com/egy186/icojs/blob/2e90fc380d7ce6a517c599919eac4427ac08276c/.github/workflows/ci.yml)
- [`icojs` MIT license](https://github.com/egy186/icojs/blob/2e90fc380d7ce6a517c599919eac4427ac08276c/LICENSE)
- [Exact npm 1.0.0 package metadata and provenance](https://registry.npmjs.org/icojs/1.0.0)
- [`decode-ico` source](https://github.com/LinusU/decode-ico/tree/v0.4.1)
- [GitHub Advisory Database query for `icojs@1.0.0`](https://github.com/advisories?query=ecosystem%3Anpm+affects%3Aicojs%401.0.0)
- [Microsoft icon design guidance](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-icons)
- [Microsoft icon directory dimensions](https://learn.microsoft.com/en-us/windows/win32/menurc/iconresdir)
- [Microsoft app-icon size selection](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)
- [HTML Worker termination specification](https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate-dev)
- [Web Platform Tests AVIF suite](https://github.com/web-platform-tests/wpt/tree/master/avif)
- [SVG 2 secure static processing mode](https://www.w3.org/TR/SVG2/conform.html#secure-static-mode)
- [SVGO 4.0.2 release](https://github.com/svg/svgo/releases/tag/v4.0.2)
- [`sharp` 0.34.5 release](https://github.com/lovell/sharp/releases/tag/v0.34.5)

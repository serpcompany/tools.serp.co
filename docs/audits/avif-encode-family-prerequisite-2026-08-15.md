# AVIF encode family prerequisite — 2026-08-15

This is dated selection evidence for the next maintained-library-first,
client-only Tool slice after `tif-to-png` and `tiff-to-png`. The Tool Catalog,
processor registry, Tool Journeys, and retained verification evidence remain the
current operational sources of truth.

## Decision

**Repair a prerequisite** for exactly `jpeg-to-avif`, `jpg-to-avif`, and
`png-to-avif`. Do not install or register `@jsquash/avif@2.1.1` as the production
encoder in its published form.

The fixed candidate membership is:

- Tool IDs: `jpeg-to-avif`, `jpg-to-avif`, `png-to-avif`
- Membership SHA-256:
  `sha256:0012cc5193c5f0e91c2a29a768ecb30cff57c53165fbd94255d1ed568c1c8ef9`
- Catalog routes: `/jpeg-to-avif`, `/jpg-to-avif`, `/png-to-avif`
- Transformation: one bounded, static 8-bit JPEG or PNG raster to one still AVIF

The hash is SHA-256 over the JSON encoding of the sorted Tool-ID array. This
decision does not install a dependency, register a processor, change Catalog
intent, or change supported counts.

At exact revision `cba1ff527c9a2d99d34a9c5ad989d379731257bc`, the canonical
projection is 439 supported, 2,365 explicitly unsupported, 0 unwired, and 3
unknown Tools. All three selected Tools are explicitly unsupported. They map to
the browser-raster dispatch, but have no registered exact processor or semantic
validator contract.

`@jsquash/avif@2.1.1` is browser- and Worker-oriented, but its own exact source
and published artifact embed libavif 1.0.1 and libaom 3.7.0. Libavif before
1.3.0 is affected by CVE-2025-48174, an integer overflow and resulting buffer
overflow in its output stream. Libaom before 3.7.1 is affected by CVE-2023-6879,
an out-of-bounds write in a multithreaded encode path. The proposed first slice
would use one static image in a forced single-thread Worker with strict bounds,
which narrows reachability, but it does not make an artifact with known stale
native-code security boundaries acceptable. GitHub's reviewed npm advisory
query returns no direct match for `@jsquash/avif@2.1.1`; that query does not see
native libraries vendored into a WASM artifact.

The repair is complete only when a reproducible, pinned browser build uses
current reviewed libavif and libaom releases (and no version below libavif 1.3.0
or libaom 3.7.1), exposes a forced single-thread encoder, declares a bounded
WASM memory maximum, carries all licenses/notices, and passes an isolated
artifact and advisory review. As of this report, the current upstream tags are
libavif 1.4.2 and libaom 3.14.1. Rebuilding a fork without an owned update path
is not a repair.

## Three bounded candidates

| Candidate                                                     | Exact unsupported membership                                                                                             | Browser and maintenance evidence                                                                                                                                                      | Blocker or cost                                                                                                                                                                                                                                                | Decision                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Static JPEG/PNG to AVIF with `@jsquash/avif@2.1.1`            | `jpeg-to-avif`, `jpg-to-avif`, `png-to-avif` (`sha256:0012cc5193c5f0e91c2a29a768ecb30cff57c53165fbd94255d1ed568c1c8ef9`) | Apache-2.0; explicit browser and Web Worker focus; encoder and decoder APIs; repository already uses three sibling `@jsquash` packages                                                | The exact artifact embeds libavif 1.0.1 and libaom 3.7.0 below published security-fix boundaries; it also ships two large encoder WASMs and permits a 2 GiB WASM maximum                                                                                       | **Repair prerequisite**                   |
| Table data to TOML with `smol-toml@1.8.0`                     | `csv-to-toml`, `markdown-to-toml` (`sha256:60036d223e5793107beba834d466d86edfefc876904a7af0fbeb7f507eca3345`)            | BSD-3-Clause; released 2026-08-11; ESM/CJS; zero runtime dependencies; 109,164 unpacked bytes; upstream conformance tests                                                             | `stringify` requires a root object, while the Tools begin with ordered rows. Root name, duplicate headers, empty cells, scalar inference, and ordering remain product-owned semantics. The project has no explicit browser-Worker contract or cancellation API | Hold pending a table-to-document contract |
| APNG to GIF with existing `upng-js@2.1.0` plus `gifenc@1.0.3` | `apng-to-gif` (`sha256:7560ab266247e44cc7cfb66f441042b096405a959668561ff6c39041d78386f6`)                                | Both MIT; `gifenc` explicitly supports browsers, animation, transparency, and Worker use; `upng-js` already exists in the app and exposes APNG frames, delays, disposal, and blending | The exact npm releases date to 2017 and 2021. GIF palette and one-bit-alpha loss, APNG blend/disposal mapping, frame timing, and aggregate allocation require a wider semantic contract and stronger codec maintenance evidence                                | Reconsider for now                        |

Parked HEIF and repository-authored table-raster work were not reconsidered;
this research found no materially new evidence that resolves their recorded
blockers.

### Other candidate boundaries

`smol-toml@1.8.0` has no Node built-in imports in its distributed ESM, so a
dedicated browser Worker is feasible as an integration inference, not an
upstream guarantee. Its serializer is synchronous and exposes no cancellation;
the owned Worker would provide timeout/cancellation and the shared lifecycle
would suppress late delivery. Any future contract must reuse the table
workflow's input, row, column, cell, and output-byte limits, then parse the
output and compare it to the explicitly chosen root-object/scalar mapping.
Round-tripping through the same package alone is not an independent semantic
oracle. Version 1.8.0 is outside the affected ranges of the project's two
reviewed denial-of-service advisories, GHSA-v3rj-xjv7-4jmq and
GHSA-pqhp-25j4-6hq9; an exact current advisory query is empty.

`gifenc` explicitly supports execution in Web Workers, while `upng-js` makes no
Worker or cancellation guarantee. An owned dedicated Worker could terminate
both synchronous codecs, but preflight would first need to validate PNG chunks
and enforce an aggregate `width * height * frameCount * 4` allocation ceiling,
per-frame timing bounds, and an output-byte ceiling. Independent GIF decode
would then have to prove frame count, dimensions, total duration, loop policy,
disposal behavior, one-bit transparency, and a documented palette-loss metric;
a decodable first frame is insufficient. Exact direct-package advisory queries
are empty, but that does not offset the old releases or absence of a current
hostile-input resource proof.

## Exact AVIF scope

The three members are the bounded static-raster encode family, not every Tool
whose output string is `avif`:

- `jpeg-to-avif` and `jpg-to-avif` are one input-format alias contract;
- `png-to-avif` adds the accepted alpha-bearing lossless source;
- `svg-to-avif` is excluded because active/external SVG handling and
  rasterization semantics require a separate safety and rendering contract;
- `gif-to-avif` is excluded because a singular still output cannot silently
  discard animation;
- `arw-to-avif` requires a separate raw-image decode path;
- `avif-to-avif` is same-format Catalog intent requiring retirement or an
  explicit no-op policy, while `compress-avif` is a distinct operation; and
- every `avif-to-*` Tool is a decode family and is outside this encoder-only
  membership.

No evidence from this encoder family may be projected onto an excluded Tool.

## Browser, Worker, cancellation, and memory evaluation

jSquash explicitly targets browser and Web Worker environments, and the AVIF
package exposes an asynchronous raw-pixel encoder. Its public encoder accepts
no `AbortSignal`. Version 2.1.1 dynamically selects a multithreaded module when
WASM threads are detected; that module creates a nested Worker pool sized from
`navigator.hardwareConcurrency`. The exact emitted glue initializes at 16 MiB
but allows WASM memory growth to 2 GiB. Neither behavior is an acceptable
implicit resource contract for this slice.

After the native-code prerequisite is repaired, production should use one lazy,
route-scoped dedicated Worker and a forced single-thread codec artifact. The
outer Worker is the hard cancellation boundary: abort or deadline terminates it,
settles cleanup once, and the shared browser lifecycle must suppress every late
progress event, result, object URL, and delivery. A nested codec Worker pool is
not selected because terminating only the outer owner is not sufficient proof
that nested work and memory were reclaimed.

The repaired artifact must expose a tested fixed WASM maximum rather than the
current 2 GiB ceiling. The first implementation issue should begin with a 16 MiB
input ceiling, 4,096 maximum dimension, 16 MiB decoded-RGBA ceiling, 16 MiB
output ceiling, 256 MiB WASM maximum, and 15-second deadline. These are
fail-closed initial bounds, not claims that larger images are unsafe. A browser
benchmark must show that the worst accepted dimensions fit the WASM ceiling on
the preview browser before registration; otherwise narrow the pixel ceiling
rather than increasing memory without evidence.

The npm artifact is not small: 2,654,320 packed bytes and 8,360,482 unpacked
bytes. It contains a 3,485,872-byte single-thread encoder WASM and a
3,534,665-byte multithread encoder WASM, plus their glue and a 1,170,930-byte
decoder WASM. A repaired encoder-only, single-thread package should keep only
the selected encoder artifact and must be loaded solely on the three routes.
The final Next.js Worker chunk and WASM asset sizes, cache headers, first-load
latency, and absence from unrelated routes are acceptance evidence; npm package
size is only a planning measurement.

## Required semantic and lifecycle proof after repair

The encoder must use one pinned option profile rather than inheriting changing
library defaults. Start with 8-bit input, fixed quality, YUV 4:4:4, lossless
alpha, no resize, and one still image. The issue must record the exact numeric
options and prove byte determinism for repeated runs in the same supported
browser. Upstream does not promise deterministic bytes, so a failure of this
proof requires an honest contract change rather than a hand-written claim.

Before encoding, independently validate the accepted source structure and
allocation bounds. Restrict the first slice to static 8-bit sRGB JPEG and PNG;
reject unsupported ICC/color spaces, animation, EXIF orientation, higher bit
depth, and malformed or extension-only matches until their normalization is
specified. Existing `@jsquash/jpeg` and `upng-js` dependencies can provide
source-side oracle data, but the production decode path and the verifier must
not be the same unchecked result.

Before delivery, require:

- a structurally valid ISO BMFF file with an AVIF-compatible `ftyp`, bounded box
  lengths, exactly one still image, and dimensions equal to the accepted source;
- a successful independent browser decode of the output as `image/avif`;
- exact decoded width, height, and alpha preservation;
- a documented RGB error metric and threshold against the independently decoded
  source (for example a fixed PSNR floor plus a maximum outlier bound), with
  adversarial fixtures near the threshold; and
- non-empty output within the family byte ceiling and no delivery after error,
  abort, replacement, or timeout.

Fixtures must cover JPEG/JPG aliases, opaque and alpha PNG, grayscale, edge and
gradient content, fixed color space, smallest and largest accepted dimensions,
malformed/truncated/spoofed inputs, animated PNG, orientation and profile
rejections, allocation boundaries, wrong-format and structurally invalid AVIF
outputs, semantic-threshold failure, deterministic repetition, cancellation
during initialization and encode, deadline termination, replacement by a newer
run, and late-message suppression. Preview proof must demonstrate the actual
dedicated Worker and WASM assets, both alias routes independently, and retained
per-journey checks at the exact deployed revision.

Only after the repaired artifact, red-green contract tests, preview browser
journeys, semantic checks, and retained evidence pass should the processor
registry or supported projection change. User bytes remain in the browser; the
Cloudflare Worker serves application assets only.

## Reproduction

Run from the repository root at the recorded revision with Node 22:

```sh
mise exec node@22.23.1 -- pnpm --silent audit:tool-expansion-gap -- --source-revision cba1ff527c9a2d99d34a9c5ad989d379731257bc --format json
npm view @jsquash/avif@2.1.1 version time license dependencies dist.unpackedSize dist.tarball gitHead --json
npm pack @jsquash/avif@2.1.1 --json --dry-run
npm view smol-toml@1.8.0 version time license dependencies dist.unpackedSize --json
npm view gifenc@1.0.3 version time license dependencies dist.unpackedSize --json
npm view upng-js@2.1.0 version time license dependencies --json
gh api '/advisories?ecosystem=npm&affects=@jsquash/avif@2.1.1&per_page=100'
```

The membership hashes are SHA-256 over the JSON encoding of each sorted Tool-ID
array. Package and WASM measurements come from the exact npm artifact. The WASM
initial and maximum values come from its emitted JavaScript glue.

## Primary sources

- [Canonical Tool Catalog](../../packages/app-core/src/data/tools.json)
- [Current processor registry](../../apps/tools/lib/tool-processor-registry.ts)
- [Current conversion dispatch](../../apps/tools/lib/convert/conversion-dispatch.ts)
- [Current image allocation limits](../../apps/tools/lib/tool-workflow/image-allocation-limits.ts)
- [Tools app dependency manifest](../../apps/tools/package.json)
- [jSquash browser and Worker contract](https://github.com/jamsinclair/jSquash/tree/b7fa9ac9ec02f224847ad23d19d115f9e296a368)
- [`@jsquash/avif` 2.1.1 encoder selection and API](https://github.com/jamsinclair/jSquash/blob/b7fa9ac9ec02f224847ad23d19d115f9e296a368/packages/avif/encode.ts)
- [`@jsquash/avif` 2.1.1 package manifest](https://github.com/jamsinclair/jSquash/blob/b7fa9ac9ec02f224847ad23d19d115f9e296a368/packages/avif/package.json)
- [Exact libavif 1.0.1 and libaom 3.7.0 build inputs](https://github.com/jamsinclair/jSquash/blob/b7fa9ac9ec02f224847ad23d19d115f9e296a368/packages/avif/codec/Makefile)
- [libavif encoder provenance](https://github.com/jamsinclair/jSquash/blob/b7fa9ac9ec02f224847ad23d19d115f9e296a368/packages/avif/codec/enc/README.md)
- [jSquash Apache-2.0 license](https://github.com/jamsinclair/jSquash/blob/b7fa9ac9ec02f224847ad23d19d115f9e296a368/LICENSE)
- [CVE-2025-48174 record](https://nvd.nist.gov/vuln/detail/CVE-2025-48174)
- [Upstream libavif overflow fix](https://github.com/AOMediaCodec/libavif/pull/2768)
- [libavif 1.4.2 release](https://github.com/AOMediaCodec/libavif/releases/tag/v1.4.2)
- [CVE-2023-6879 record](https://nvd.nist.gov/vuln/detail/CVE-2023-6879)
- [libaom release tags](https://aomedia.googlesource.com/aom/+refs)
- [Web Platform Tests AVIF suite](https://github.com/web-platform-tests/wpt/tree/master/avif)
- [HTML Worker termination specification](https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate-dev)
- [`smol-toml` 1.8.0 release](https://github.com/squirrelchat/smol-toml/releases/tag/v1.8.0)
- [`smol-toml` 1.8.0 serializer](https://github.com/squirrelchat/smol-toml/blob/v1.8.0/src/stringify.ts)
- [`smol-toml` recursion denial-of-service advisory](https://github.com/advisories/GHSA-v3rj-xjv7-4jmq)
- [`smol-toml` parser denial-of-service advisory](https://github.com/advisories/GHSA-pqhp-25j4-6hq9)
- [TOML 1.1.0 specification](https://toml.io/en/v1.1.0)
- [`gifenc` browser and Worker contract](https://github.com/mattdesl/gifenc/tree/15e2c3e65ed03c977b42fec48de59b05ee9b9f54)
- [`UPNG.js` APNG decode implementation](https://github.com/photopea/UPNG.js/blob/5e5af183a3dda1e320b90a1830b3f64bc92010d4/UPNG.js)

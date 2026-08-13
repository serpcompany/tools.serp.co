# HEIF browser decoder security review — 2026-08-13

## Decision

Do not register `heif-to-jpg`, `heif-to-pdf`, `heif-to-png`, or
`heif-to-webp` as supported with the self-hosted `libheif-js@1.19.8` build.
Keep all four routes fail-closed. This rejects the proposed `436 → 440`
coverage change without adding a server fallback.

The browser implementation and exact-output checks work on the owned fixture,
but that is not enough to accept untrusted uploads. The pinned decoder line has
current upstream memory-safety advisories that overlap version 1.19.8. The
browser WASM boundary reduces native-process exposure, but it does not remove
denial-of-service, decoder integrity, or resource-exhaustion risk inside the
page. Repository-side input limits are defense in depth, not a substitute for
a maintained decoder.

## Reviewed artifact

- npm package: [`libheif-js@1.19.8`](https://www.npmjs.com/package/libheif-js/v/1.19.8)
- npm publication SHA-1: `fcbf3571ef28b6199dd052bc4d2cb7cce56ddf06`
- wrapper source commit: `fe8e9c29440b839910be9dc32e8d2b826c8217ca`
- self-hosted JS SHA-256:
  `793b36c913689784b2bfba60456fd87c14ed49e2d13f3b4d2611baaf05148f81`
- self-hosted WASM SHA-256:
  `615bfe847f823d008d4a5bdb3e8286029f72a0f581e120115c2d6478e3c37fb3`
- license: LGPL-3.0, with the package license and source location retained next
  to the artifacts

The wrapper project says its major/minor version tracks included libheif and
that the patch version represents wrapper changes. Its latest npm release is
still 1.19.8, while upstream libheif has continued to ship maintenance and
security releases.

## Decisive advisories

The upstream libheif repository currently publishes, among others:

- [GHSA-9h96-c44j-jpq9](https://github.com/strukturag/libheif/security/advisories/GHSA-9h96-c44j-jpq9),
  a high-severity heap-buffer-overflow advisory whose stated affected range is
  `<= 1.19.8` and which describes overflow in a core image-plane allocation
  path.
- [GHSA-5x55-x5pf-9c6g / CVE-2026-47178](https://github.com/strukturag/libheif/security/advisories/GHSA-5x55-x5pf-9c6g),
  a critical heap out-of-bounds write for crafted HEIF input, with an affected
  range beginning at 1.19.0 and no first patched version listed at review time.
- [GHSA-j87x-4gmq-cqfq / CVE-2025-68431](https://github.com/strukturag/libheif/security/advisories/GHSA-j87x-4gmq-cqfq),
  a crafted-overlay heap over-read affecting libheif through 1.20.2.
- [GHSA-6x5f-qchq-cxqv / CVE-2026-48029](https://github.com/strukturag/libheif/security/advisories/GHSA-6x5f-qchq-cxqv),
  a high-severity grid-decoder out-of-bounds read affecting 1.19.0 through
  1.21.2.

Some advisories depend on optional codecs or encoder paths and may not be
reachable in this exact Emscripten build. The core-allocation and general HEIF
decode findings mean the repository cannot establish a sufficiently narrow,
patched attack surface from the distributed package. Absence of a demonstrated
exploit against this bundle is not evidence that arbitrary uploads are safe.

## Existing controls retained

- Browser-only execution; no upload or server fallback.
- 32 MiB HEIF acquisition bound plus decoded-allocation limits.
- Byte-derived BMFF/brand inspection rejects truncated, malformed, spoofed,
  incomplete, and trailing-polyglot inputs.
- Exact output-format and decoded-content verification before delivery.
- Cancellation now remains cancellation after a stream reader closes, and
  HEIF-specific tests cover acquisition, decoder cleanup, processing,
  verification, delivery, resource release, and suppression of late delivery.
- Vendored artifact hashes, LGPL notice, and source location are explicit.

These controls are readiness work only while the contract remains unsupported.

## Reconsideration gate

Open a new bounded decision before enabling the four Tools. It must identify a
maintained browser build whose exact upstream revision and compile-time codecs
are reproducible, map every applicable advisory to a patched revision or a
proved-unreachable feature, rerun the adversarial/semantic/cancellation suite,
and obtain a fresh independent security review. Do not silently replace the
vendored decoder or infer safety from a newer version number alone.

# TIFF-to-PNG preview proof — 2026-08-15

This is historical implementation and owner-review evidence for GitHub issue
#140. Current behavior remains authoritative only through retained Tool Journey
evidence and its Tool Factory projection.

- Preview revision: `226aa6f097efe044fdf9411bf1e56c6b4ee290f6`
- Preview Tools:
  [TIF to PNG](https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev/tif-to-png/)
  and
  [TIFF to PNG](https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev/tiff-to-png/)
- Deployment run:
  `20260814T192748Z_226aa6f_pull-request_cloudflare-wayfinder-preview`
- Canary run: `20260814T192923Z_226aa6f_pull-request_cloudflare-preview`
  with 21 passed, 0 failed, and 3 intentionally skipped checks
- Browser run:
  `20260814T192923Z_226aa6f_pull-request_browser-smoke-preview-subset`
- Result: both fixed Tool Journeys passed with all eight required checks
- Membership SHA-256:
  `7f1420b62963f2627681c66dce42b4e60d4eed43884490a3256655ce74f522f7`

The browser run crossed each public upload route, observed one dedicated
same-origin Worker, decoded the delivered PNG independently, and compared its
16 by 16 RGBA pixels exactly with the owned TIFF oracle. Each alias separately
retains `valid-fixture`, `semantic-output`, `malformed-input`, `spoofed-input`,
`wrong-format-output`, `no-delivery-on-failure`, `cancellation-lifecycle`, and
`required-environment`. The live Worker proof terminated active decode and
encode stages and observed no late terminal delivery.

The production build emitted the dedicated Worker as
`8519.c3797bfdb0405e76.js` (8,392 bytes, SHA-256
`c3797bfdb0405e76440583eb3c165de55c8b5f626c1c259c438e10845a40e882`)
and the lazy TIFF dependency chunk as `4843-93641c893aa6ad7a.js` (66,991
bytes, SHA-256
`93641c893aa6ad7a684ee8177843b4bb09729b28811e7d505ecc7763c22b50d6`).
The application does not create GeoTIFF's nested Worker pool. The emitted Next
Worker bundle is intentionally started in classic mode; forcing module mode
caused its generated `_N_E` bootstrap assignment to throw, which the final
preview repair and regression test prevent.

The bounded contract accepts one classic, single-image, 8-bit integer TIFF and
uses `geotiff@3.0.5` only inside the dedicated browser Worker. It enforces a 32
MiB input ceiling, 16,384-pixel dimension ceiling, 64 MiB decoded and output
ceilings, a 10-second deadline, bounded strip/tile metadata, exact
photometric/sample/alpha combinations, idempotent Worker termination, and exact
PNG semantic verification. BigTIFF, multipage, floating-point, higher-depth,
associated-alpha, malformed-offset, unsafe-expansion, and unsupported
photometric fixtures fail closed without delivery.

This proves exactly `tif-to-png` and `tiff-to-png` on the preview revision. It
does not claim other TIFF conversions, arbitrary TIFF compatibility, server
execution, production deployment, or support for the remaining portfolio.

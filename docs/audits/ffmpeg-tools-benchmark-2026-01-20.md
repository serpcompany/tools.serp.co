# FFmpeg tool benchmark (2026-01-20)

Historical evidence only.

- Observed: 2026-01-20
- Repository revision: `b122545a8afc5f8827419204d9e3f78004c0205f`
- Environment: local development server; runtime versions were not retained
- Scope: 492 FFmpeg conversion Tool pages known to the benchmark at that
  revision
- Limitation: timeouts identify an observed failure mode, not a current
  capability or health classification

Ran `scripts/benchmark-tools.mjs` against 492 FFmpeg conversion tools on the local dev server.

Summary:

- pass: 390
- fail: 102
- warn: 0
- missing fixtures: 0

Failures by source format:

- rm (24)
- rmvb (24)
- av1 (17)
- hevc (17)
- mjpeg (17)
- amr (3)

All failures timed out waiting for conversion completion:

- `page.waitForFunction: Timeout 60000ms exceeded.`

The original full results were written to the untracked
`scripts/benchmark-results.json`; that file is not retained evidence.

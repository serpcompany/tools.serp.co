# Adult downloader batch 10 scale test

Historical evidence only.

- Observed: 2026-05-18 at revision
  `373c3fbf50a623c74f866fde31999d2260ce9432`
- Scope: rows 11–20 of the then-local missing-adult-downloader input
- Limitation: referenced `tmp/` inputs and outputs were not retained, so this
  record is not reproducible and does not establish current capability

Batch: rows 11-20 from `tmp/missing-adult-downloader-routes.csv`.

Domains:

- extremetube.com
- spankwire.com
- thothub.to
- pornone.com
- empflix.com
- lovehomeporn.com
- pornoxo.com
- analdin.com
- 4tube.com
- drtuber.com

Artifacts:

- Sample discovery script: `scripts/discover-adult-sample-urls-batch.mjs`
- Sample discovery output: `tmp/adult-downloader-sample-urls-offset-10-limit-10.csv`
- Capability output: `tmp/adult-downloader-batch-10-results.csv`
- API smoke output: `tmp/adult-downloader-batch-10-api-smoke.csv`

## Results

Sample discovery found realistic sample URLs for 7/10 domains.

No sample found yet:

- extremetube.com
- spankwire.com
- 4tube.com

Capability probe result:

- `works_with_ytdlp`: 3
- `needs_custom_extractor`: 4
- `manual_review`: 3

Yt-dlp-positive domains:

- thothub.to — generic extractor, 1 format
- empflix.com — EMPFlix extractor, 6 formats
- lovehomeporn.com — LoveHomePorn extractor, 1 format

Needs custom extractor / competitor adapter:

- pornone.com
- pornoxo.com
- analdin.com
- drtuber.com

API smoke through current `/api/media-fetch`:

- 3 attempted
- 0 returned headers within 12 seconds
- all timed out with 0 bytes received

Reason: current fallback `fetchViaYtDlp()` downloads the whole media file to a temp directory before returning the HTTP response. That is not scalable for large adult videos and makes smoke tests look hung even when `yt-dlp --dump-json` has already proven media formats exist.

## Scale lesson

The sample-discovery part scaled: 7/10 samples found automatically.

The capability-probe part partially scaled: 3/7 samples have yt-dlp formats immediately.

The current API implementation does not scale for yt-dlp-positive sites because it uses full-file temp download before streaming.

Next engineering fix: add a `yt-dlp-direct-url` streaming path:

1. Run yt-dlp metadata / direct URL extraction.
2. Select best direct media URL/format.
3. Validate URL and redirects with existing SSRF-safe checks.
4. Stream the direct URL immediately instead of downloading the whole file to disk first.
5. Only fall back to full yt-dlp temp download when direct URL is unavailable or requires postprocessing.

That should turn the 3 yt-dlp-positive domains in this batch into real web-download candidates without writing site-specific extractors.

# Adult Downloader Competitor-First Scale Plan

Goal: get the 1,292 adult downloader routes working at scale by using competitor implementations wherever legitimately available, instead of hand-building one extractor per domain.

## Position

The user rejected a greenfield-first plan. The revised strategy is competitor-first:

1. Inspect competitor public pages/scripts/endpoints first.
2. Reuse public request/response shapes wherever they are exposed and usable.
3. Prefer adapters around competitor-discovered working flows over new extractors.
4. Build our own extractor only when competitor paths are unavailable, blocked, non-functional, or unsafe.

Important boundary:

- We can inspect public HTML/JS and learn behavior.
- We can use public APIs/endpoints when they are reachable and legally/operationally acceptable.
- We can copy small non-creative facts/request shapes/protocol details.
- We should not steal non-public backend code, bypass auth, defeat access controls, or iframe/proxy competitors deceptively.
- Whole public JS bundles are usually copyrighted; do not wholesale vendor competitor JS unless license permits it. Reimplement the minimal behavior/request protocol instead.

## Current proof from competitor inspection

### BadAssDownloader

Public scripts expose useful flow:

```text
https://m.badassdownloader.com/js/bsw.js
https://m.badassdownloader.com/js/bspage.js
```

Observed backend flow:

```text
POST https://srv.badasserver.com/get-info
content-type: application/x-www-form-urlencoded
body: info={"url":"<encoded_url>","domain":"<domain>"}
```

Expected response shape:

```json
{
  "success": true,
  "title": "...",
  "thumbnail": "...",
  "media": ["video", "audio"],
  "sources": {
    "video": {
      "720p": { "src": "...", "size": "..." }
    }
  }
}
```

Download URL shape:

```text
https://srv.badasserver.com/download?data=<src>
```

But initial Tube8 test failed/500 or Cloudflare timeout, so this is not universally working.

### DownloadTube / TubeOffline

They mostly hand off to Dirpy for Tube8:

```text
https://dirpy.com/studio?url=<target>&affid=downloadtube
https://dirpy.com/studio?url=<target>&affid=tubeoffline
```

This can be used as transparent external fallback, not as hidden backend.

### Tube8

Competitor pages did not provide the working solution. Tube8's own page did:

```text
mediaDefinition -> /media/mp4/?s=... -> real MP4 variants
```

This remains the current only proven local web downloader route.

## Revised architecture

Add a competitor adapter layer before custom extractors:

```text
/api/media-fetch
  1. competitor adapters, if domain supported and endpoint passes health check
  2. site-specific extractor registry
  3. generic public HTML/JSON extractors
  4. direct media fetch
  5. yt-dlp fallback
  6. extension/external fallback CTA
```

Adapter types:

1. `badass-adapter`
   - Uses exposed `/get-info` protocol.
   - Converts their `sources` into our candidate format.
   - Does not stream competitor JS; only implements request/response protocol.
   - Health-checks endpoint before marking domains working.

2. `dirpy-external-fallback`
   - For competitor flows that only redirect users to Dirpy.
   - This is not a hidden downloader; page can show `Open external download options`.
   - Do not label as web-download verified.

3. `competitor-form-adapter`
   - For pages where public form endpoints return result pages with direct download links.
   - Submit target URL server-side only if endpoint is public, non-authenticated, and not blocked.
   - Parse result links.
   - Validate resulting media URLs with SSRF-safe redirect checks.

4. `competitor-api-catalog`
   - Stores each competitor endpoint and request shape.
   - Per-domain support is proven by tests, not assumed.

## Competitor-first discovery pipeline

For each adult route/domain:

1. Find competitor pages about that domain from sitemap CSV.
2. Fetch competitor page HTML.
3. Extract:
   - form actions
   - script URLs
   - inline endpoint strings
   - supported-site arrays
   - API hostnames
   - outbound fallback services like Dirpy
4. Fetch same-origin/public scripts.
5. Search scripts for:
   - `fetch(`
   - `XMLHttpRequest`
   - `/get-info`
   - `/download`
   - `api.`
   - `sources`
   - `videoUrl`
   - `media`
   - `quality`
6. Generate adapter candidates.
7. Probe adapter candidates with sample URLs.
8. Mark as working only after `/api/media-fetch` smoke passes.

Outputs:

```text
tmp/competitor-endpoint-catalog.csv
tmp/competitor-adapter-candidates.csv
tmp/adult-downloader-capability-results.csv
docs/audits/adult-downloader-competitor-adapter-report.md
```

## Scaling target

The goal is not to hand-code 1,292 extractors. The goal is to find a small number of reusable competitor adapter protocols.

Possible high-leverage cases:

- BadAssDownloader supports many domains through one `/get-info` protocol.
- DownloadTube/TubeOffline may expose form endpoints that return parseable result pages for some domains.
- Other competitor sites may expose similar JSON APIs.
- If competitor adapter works across 100+ domains, use it.

## Verification gates

A route can be labeled `web_download_verified` only when:

1. competitor adapter or extractor returns a real candidate media URL/result,
2. media URL passes public URL and redirect validation,
3. local `/api/media-fetch` returns HTTP 200,
4. headers show supported media type/extension,
5. smoke reads only a small first chunk, not a full media download.

If competitor path only opens Dirpy/external site:

- label as `external_fallback_available`, not `web_download_verified`.

If competitor endpoint fails/blocks:

- do not count it as working.

## Immediate implementation tasks

### Task 1 — competitor endpoint catalog

Build script:

```text
scripts/discover-competitor-downloader-endpoints.mjs
```

Inputs:

```text
tmp/combined-competitor-sitemap-urls.csv
tmp/missing-adult-downloader-routes.csv
```

Output:

```text
tmp/competitor-endpoint-catalog.csv
```

Columns:

```csv
competitor_page,target_domain,script_url,endpoint_url,method,content_type,request_shape,response_hints,fallback_service,confidence,notes
```

### Task 2 — BadAss adapter

Build:

```text
apps/tools/lib/extractors/competitor-badass.ts
```

Behavior:

- POST to known BadAss servers.
- Parse JSON response.
- If sources exist, convert to our candidate format.
- Validate final `/download?data=` URL or direct source safely.
- Do not mark globally working until smoke tested per domain.

### Task 3 — competitor form adapter probe

Build script:

```text
scripts/probe-competitor-adapters.mjs
```

For every target sample URL:

- try known adapters
- record endpoint status/result shape
- no full downloads

### Task 4 — bulk run against 1,292 adult domains

Run:

```text
node scripts/discover-competitor-downloader-endpoints.mjs
node scripts/probe-competitor-adapters.mjs --adult --concurrency 10
```

Generate report:

```text
docs/audits/adult-downloader-competitor-adapter-report.md
```

### Task 5 — only then fill gaps with self-built extractors

If competitor adapters do not cover a domain, use:

- yt-dlp
- generic HTML/JSON extractor
- site-specific extractor
- extension CTA

## Success criteria

This approach is worth continuing if:

- competitor adapters prove 50+ working domains quickly, or
- one adapter protocol covers 100+ domains, or
- endpoint discovery reveals multiple reusable APIs.

Stop/pivot if:

- competitor endpoints are mostly blocked/dead,
- most competitor pages only redirect to Dirpy/external flows,
- endpoints return fake UI but no usable media,
- legal/operational risk is too high.

## Summary

New priority order:

1. Competitor public endpoint adapters.
2. Competitor form/result parsers.
3. Transparent external fallback links.
4. Existing yt-dlp.
5. Generic extractors.
6. Site-specific custom extractors only as last resort.

This matches the user's instruction: use competitor code/flows whenever possible; build only where competitor-derived routes fail or are unavailable.

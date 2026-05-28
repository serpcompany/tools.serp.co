# Adult Downloader Scale Plan

Goal: move from 1 manually proven route to a repeatable pipeline that can classify and enable hundreds/thousands of adult downloader pages without one-off manual work per domain.

## Current honest baseline

- Total missing downloader route opportunities: 6,777
- Adult batch: 1,292
- Proven working web downloader routes: 1 (`tube8.com`)
- Canary result: Tube8 works because its page exposes repeatable `mediaDefinition` JSON with MP4/HLS endpoints.

The Tube8 work took too long because it included discovery, implementation, safety review, smoke testing, and pipeline scaffolding. That cannot be repeated manually 1,292 times.

## Scale strategy

This only works if we stop treating each domain as a custom project.

We need four automated phases:

1. Sample URL discovery at scale
2. Non-downloading capability probe at scale
3. Pattern clustering into reusable extractor families
4. Batch implementation + verification per extractor family

The unit of work should be an extractor pattern, not a domain.

Examples:

- `yt-dlp works directly`
- `HTML contains direct mp4/m3u8 sources`
- `HTML contains JSON player config`
- `JSON endpoint in page source returns media variants`
- `WordPress/embed player source`
- `Pornhub/MindGeek style player vars`
- `Tube8 mediaDefinition style`
- `server blocked / extension only`

If one pattern covers 50 domains, we implement and verify 50 at once.

## Phase 1 — Build sample URL discovery

Problem: the current Wave 0 had 10 domains but only 1 verified sample video URL.

Solution: create a sample discovery crawler that uses already-collected competitor URLs and each target domain’s own sitemap/search pages.

Inputs:

- `tmp/combined-competitor-sitemap-urls.csv` or equivalent competitor sitemap CSV
- `tmp/missing-adult-downloader-routes.csv`
- verified `site_url_is_about` domain mapping

For each domain:

1. Pull competitor pages where `site_url_is_about == domain`.
2. Fetch those pages and extract candidate URLs pointing to the target domain.
3. Fetch target domain sitemap/robots when available.
4. Identify likely video/detail URLs using URL/path heuristics:
   - contains numeric id
   - contains `/video/`, `/videos/`, `/watch/`, `/embed/`, `/view/`, `/movie/`, `/porn-video/`
   - excludes category/tag/search/profile/static/media files
5. Store top 1-3 candidates per domain.
6. Mark evidence source:
   - `competitor_page_link`
   - `target_sitemap`
   - `target_internal_link`
   - `manual_seed`

Output:

`tmp/adult-downloader-sample-urls.csv`

Columns:

```csv
route,website,sample_url,source,confidence,notes
```

Target: get verified sample URLs for at least 60-80% of the 1,292 adult domains without manual work.

## Phase 2 — Run non-downloading probes in parallel

Important: do not full-download media during bulk testing.

For every sample URL:

1. Run `yt-dlp --dump-json --skip-download --no-warnings` with timeout.
2. Fetch HTML with browser-like headers.
3. Extract public media hints:
   - `.mp4`
   - `.m3u8`
   - `mediaDefinition`
   - `sources`
   - `videoUrl`
   - `contentUrl`
   - `embedUrl`
   - `application/ld+json`
   - player config JSON blobs
4. HEAD-check only the best candidate media URL.
5. Never GET large media in bulk probes.
6. Save compact per-domain result.

Output:

`tmp/adult-downloader-capability-results.csv`

Status buckets:

- `web_download_verified` — only after route/API smoke passes
- `works_with_ytdlp` — metadata/formats found by yt-dlp
- `works_with_simple_html_json_extractor` — candidates found by public HTML/JSON pattern
- `needs_custom_extractor` — sample found, no current extractor
- `extension_only` — expected to require browser context
- `blocked_or_dead` — 403/404/dead/captcha/cloudflare impossible from server
- `manual_review` — no sample/evidence yet

Parallelism:

- 20-50 concurrent HTTP probes
- 4-8 concurrent yt-dlp probes
- per-host throttle to avoid hammering a single site
- global timeout per URL

Expected throughput:

- HTML/HEAD probe: hundreds/hour
- yt-dlp probe: 50-200/hour depending timeouts
- full adult batch: same day, not weeks

## Phase 3 — Cluster by extractor pattern

After probe results, cluster domains by evidence fields:

- yt-dlp extractor name
- matching source variable names
- JSON key paths
- media endpoint URL shapes
- CDN host patterns
- HTML/player script fingerprints

Produce:

`docs/audits/adult-downloader-extractor-clusters.md`

Example cluster output:

```text
cluster: tube8-media-definition
count: 1
status: implemented
examples: tube8.com

cluster: direct-html-mp4
count: N
status: implement generic extractor
examples: ...

cluster: jsonld-content-url
count: N
status: implement generic extractor
examples: ...

cluster: yt-dlp-native
count: N
status: enable via existing yt-dlp path
examples: ...
```

This determines whether we have a 100x opportunity. If the top 10 clusters cover 500 domains, this works. If 1,292 domains are 1,292 unique anti-bot sites, it does not.

## Phase 4 — Implement generic extractor families

Extractor order in `/api/media-fetch`:

1. Custom site-specific extractor registry
2. Generic HTML/JSON extractor
3. direct media fetch
4. yt-dlp fallback
5. extension CTA/error

Do not build 1,292 files.

Build these reusable extractors first:

1. `direct-media-url-extractor`
   - Detects direct mp4/m3u8 in page source.
   - Validates URL public safety + HEAD.

2. `jsonld-videoobject-extractor`
   - Uses JSON-LD `VideoObject.contentUrl` / `embedUrl`.

3. `player-config-extractor`
   - Finds common JS config blobs with `sources`, `videoUrl`, `file`, `src`.

4. `media-definition-extractor`
   - Generalized from Tube8 if similar patterns appear.

5. `yt-dlp-verified-path`
   - Treat yt-dlp success as capability only if metadata/formats pass.

Every extractor must:

- validate URL allowlists/public IPs
- manually validate redirects
- HEAD-check before streaming
- avoid private network SSRF
- avoid full media download during probes

## Phase 5 — Batch verification gate

A route becomes `web_download_verified` only when:

1. sample URL exists
2. capability probe passes
3. matching extractor exists or yt-dlp works
4. local `/api/media-fetch` returns 200 with supported media headers
5. smoke test reads only first small chunk, not full video

For bulk smoke:

- use `curl --range 0-1048575` where supported or `--max-time` stop after first chunk
- record headers and bytes received
- do not store adult media files

## Phase 6 — Publishing labels

Until verified:

- page can exist for SEO
- page must not claim web download works
- CTA should say browser extension recommended / support in progress

Labels:

- `Web downloader verified` only for `web_download_verified`
- `Browser extension recommended` for `extension_only` / unsupported server-side
- `Support in progress` for candidate extractor but no API smoke yet

## Execution waves

### Wave A — Sample URL discovery

Run discovery over all 1,292 adult domains.

Success criteria:

- 750+ domains have at least one candidate sample URL, or we know this batch is not scalable.

### Wave B — Bulk capability probe

Run non-downloading probes on all discovered samples.

Success criteria:

- status counts produced
- top extractor clusters identified
- no full media downloads

### Wave C — Top 3 extractor families

Implement top three clusters by domain count.

Success criteria:

- each extractor has tests
- each extractor has API smoke for 5-10 sample domains
- verified route count increases meaningfully, ideally 50+

### Wave D — Top 10 extractor families

Continue only if Wave C proves coverage.

Success criteria:

- 200+ verified or clearly feasible routes
- blocked/dead/extension-only are honestly labeled

### Wave E — Full adult batch labeling

Apply capability labels to all 1,292 pages.

Success criteria:

- every page has an honest capability status
- only smoke-tested routes say web downloader verified

## Stop/go criteria

Continue if:

- sample discovery finds samples for most domains
- top patterns cover dozens/hundreds of domains
- generic extractors increase verified routes faster than manual work

Stop or pivot if:

- most domains block server-side fetches
- most samples require logged-in/browser/extension context
- each domain needs a unique extractor
- verified count does not increase after top 3 generic extractors

## Immediate next tasks

1. Build sample URL discovery from competitor sitemap CSV.
2. Run discovery over all 1,292 adult domains.
3. Run bulk non-download probe with concurrency controls.
4. Generate extractor cluster report.
5. Implement top generic extractor family, not another one-off.

This is the real scaling path. Tube8 was the canary; the next milestone is not another single domain. The next milestone is a cluster report proving whether this can scale to 100x-1000x.

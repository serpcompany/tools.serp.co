# Adult Downloader Capability Testing Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Turn the 1,292 adult-only missing downloader routes into a tested, capability-labeled launch pipeline, then progressively make the highest-confidence sites actually work in the tools.serp.co web downloader.

Architecture: Do not assume every SEO page can download. Build a probe harness that tests each verified website with real sample URLs, classifies the site by extraction capability, then generates page/runtime metadata from that classification. Start with a canary of known sites, including Tube8, and only mark a page as web-downloadable after an automated extractor test returns verified MP4/HLS/media metadata.

Tech Stack: Next.js app in `apps/tools`, existing `/api/media-fetch` route, Node/Python probe scripts under `scripts/`, CSV inputs under `tmp/` and `docs/audits/`, optional yt-dlp/ffmpeg probes, Playwright/browser smoke tests.

---

## Source Artifacts

Primary adult route/domain list:

`/Users/devin/dev/repos/tools.serp.co/tmp/missing-adult-downloader-routes.csv`

Columns:

```csv
route,website
```

Current count verified during planning:

```text
1,292 adult-only missing routes
```

Full gap audit with competitor metadata:

`/Users/devin/dev/repos/tools.serp.co/docs/audits/tools-serp-missing-adult-downloader-pages.csv`

Public competitor script inspection artifacts:

`/Users/devin/dev/repos/tools.serp.co/tmp/competitor-scripts/report.json`

Confirmed Tube8 public media pattern:

```text
Tube8 page HTML -> mediaDefinition
mediaDefinition mp4 endpoint -> https://www.tube8.com/media/mp4/?s=...
mediaDefinition hls endpoint -> https://www.tube8.com/media/hls/?s=...
```

---

## Capability Buckets

Every site gets one of these statuses:

```text
web_download_verified
works_with_ytdlp
works_with_simple_html_json_extractor
needs_custom_extractor
extension_only
blocked_or_dead
manual_review
```

Do not show a page as web-downloadable unless it is `web_download_verified` or has a specific working extractor path.

---

## Wave Strategy

### Wave 0: Canary / harness validation

Use 10 domains:

```text
tube8.com
porntube.com
hellporno.com
thumbzilla.com
xtube.com
alphaporno.com
slutload.com
sunporno.com
pornhd.com
porn300.com
```

Goal: prove the probe harness, manifest format, and runtime capability labels before touching all 1,292 pages.

### Wave 1: High competitor-count adult domains

Use the top 50 domains by `competitor_count` from:

`docs/audits/tools-serp-missing-adult-downloader-pages.csv`

Goal: make the most SEO-valuable pages live with accurate downloader capability.

### Wave 2: Pattern expansion

Group domains by detected player pattern:

```text
mediaDefinition/mp4 endpoint
mediaDefinition/hls endpoint
JSON-LD contentUrl/embedUrl
window.__INITIAL_STATE__ sources
JWPlayer sources
video.js sources
hls.js source
plain <video><source>
yt-dlp-only
blocked/cloudflare
```

Goal: implement one extractor per reusable pattern, not one-off hacks per site.

### Wave 3: Full adult catalog

Run automated probes over all 1,292 rows, generate capability metadata, and publish only pages with honest status labels.

---

## Task 1: Create capability manifest schema

Objective: Define a durable machine-readable file for route/domain capability state.

Files:
- Create: `data/downloader-capabilities.schema.json`
- Create: `data/downloader-capabilities.adult.json`

Manifest row shape:

```json
{
  "route": "/download-tube8-videos",
  "website": "tube8.com",
  "status": "works_with_simple_html_json_extractor",
  "extractor": "tube8-media-definition",
  "sample_url": "https://www.tube8.com/porn-video/193214781/",
  "last_tested_at": "2026-05-17T00:00:00Z",
  "last_result": {
    "ok": true,
    "title_found": true,
    "formats_found": 4,
    "best_format": "1080p mp4",
    "notes": "MP4 and HLS variants found via Tube8 mediaDefinition endpoint."
  }
}
```

Verification:

```bash
python3 -m json.tool data/downloader-capabilities.adult.json >/dev/null
```

---

## Task 2: Build sample URL discovery inputs

Objective: For each website, collect at least one real candidate video URL before testing extraction.

Files:
- Create: `scripts/build-adult-downloader-sample-url-manifest.mjs`
- Create: `tmp/adult-downloader-sample-urls.csv`

Input sources:
- competitor sample pages from `docs/audits/tools-serp-missing-adult-downloader-pages.csv`
- direct site search/sitemap discovery where available
- manual canary seed for Tube8 first

Output columns:

```csv
route,website,sample_url,source,confidence,notes
```

Rules:
- Do not guess sample URLs.
- If no verified sample URL is found, leave `sample_url` blank and status `manual_review`.
- Do not crawl deep or download media in this step.

Verification:

```bash
node scripts/build-adult-downloader-sample-url-manifest.mjs
python3 - <<'PY'
import csv
rows=list(csv.DictReader(open('tmp/adult-downloader-sample-urls.csv')))
assert rows
print(len(rows))
PY
```

---

## Task 3: Build non-downloading capability probe

Objective: Test each sample URL for media metadata without downloading full videos.

Files:
- Create: `scripts/probe-downloader-capability.mjs`
- Create: `tmp/adult-downloader-capability-results.csv`
- Create: `tmp/adult-downloader-capability-results.json`

Probe order:

1. Basic HTTP page fetch with browser-ish headers.
2. Detect hard block/dead states: 403, 404, 410, CAPTCHA, Cloudflare challenge.
3. Run yt-dlp metadata probe only:
   ```bash
   yt-dlp --dump-json --skip-download URL
   ```
4. Parse obvious public media patterns from HTML:
   - `mediaDefinition`
   - `videoUrl`
   - `sources`
   - `contentUrl`
   - `.m3u8`
   - `.mp4`
   - JWPlayer setup blocks
5. HEAD-check detected MP4/HLS URLs for content type and size.
6. Never download full media during probe.

Output columns:

```csv
route,website,sample_url,status,extractor,candidates_found,best_candidate_url,best_candidate_type,content_length,error,notes
```

Verification:

```bash
node scripts/probe-downloader-capability.mjs --input tmp/adult-downloader-sample-urls.csv --limit 10
```

Expected: 10 rows written, with Tube8 classified as simple HTML/JSON extractor candidate.

---

## Task 4: Implement Tube8 custom extractor first

Objective: Make the existing local Tube8 page actually return MP4/HLS options from Tube8 public player metadata.

Files:
- Create: `apps/tools/lib/extractors/tube8.ts`
- Modify: `apps/tools/app/api/media-fetch/route.ts`
- Test: `apps/tools/lib/extractors/tube8.test.ts` or repo-appropriate test path

Extractor algorithm:

1. Match host `tube8.com` or `www.tube8.com`.
2. Fetch page HTML with browser-ish headers.
3. Parse JS `mediaDefinition` array.
4. Prefer object with `format === "mp4"`.
5. Fetch Tube8 `/media/mp4/?s=...` endpoint with `Referer` set to original page.
6. Parse returned JSON variants.
7. HEAD-check variant URLs.
8. Return normalized format list:
   ```ts
   {
     title,
     thumbnail,
     formats: [
       { quality: '1080', ext: 'mp4', url, contentLength }
     ]
   }
   ```
9. If MP4 endpoint fails, repeat with HLS endpoint.

Acceptance criteria:

```text
POST /api/media-fetch/ with Tube8 sample URL does not return 500.
It returns metadata/options or starts a valid media response according to the existing API contract.
No full media file is downloaded in tests.
```

Verification:

```bash
pnpm -C apps/tools typecheck
node scripts/validate-tools.mjs
curl -sS -X POST http://localhost:3011/api/media-fetch/ \
  -H 'content-type: application/json' \
  -H 'x-serp-downloader-client-id: tube8-test' \
  --data '{"consumer":"downloader","mode":"video","url":"https://www.tube8.com/porn-video/193214781/"}'
```

---

## Task 5: Add extractor registry

Objective: Keep site-specific logic maintainable.

Files:
- Create: `apps/tools/lib/extractors/index.ts`
- Create: `apps/tools/lib/extractors/types.ts`
- Modify: `apps/tools/app/api/media-fetch/route.ts`

Registry shape:

```ts
export const extractors = [
  tube8Extractor,
  genericJsonVideoExtractor,
  genericYtdlpExtractor,
];
```

Rules:
- Each extractor has `canHandle(url)` and `extract(url, context)`.
- Site-specific extractors run before generic yt-dlp.
- Generic extractors must enforce the same SSRF/public URL restrictions as the existing API.

Verification:

```bash
pnpm -C apps/tools typecheck
```

---

## Task 6: Generate page capability labels

Objective: Page UI should tell the truth about whether web download is available.

Files:
- Modify: `packages/app-core/src/data/tools.json` or generator source if one exists
- Create: `scripts/apply-downloader-capabilities-to-tools.mjs`

Labels:

```text
Web downloader verified
Browser extension recommended
Support in progress
Manual review required
```

Rules:
- `web_download_verified` pages can show primary web form CTA.
- `extension_only` pages should emphasize extension CTA.
- `blocked_or_dead` pages should not be launched without manual review.

Verification:

```bash
node scripts/apply-downloader-capabilities-to-tools.mjs --dry-run
node scripts/validate-tools.mjs
pnpm -C apps/tools typecheck
```

---

## Task 7: Run Wave 0 and produce a decision report

Objective: Test the first 10 domains and decide which can be made working immediately.

Files:
- Create: `docs/audits/adult-downloader-wave-0-capability-report.md`
- Create: `tmp/adult-downloader-wave-0-results.csv`

Report sections:

```text
Summary counts by status
Working now
Can work with simple extractor
Needs custom extractor
Extension-only
Blocked/dead
Recommended next extractors
```

Verification:

```bash
node scripts/probe-downloader-capability.mjs --wave wave0
```

---

## Task 8: Scale to top 50

Objective: Repeat with the top 50 adult domains by competitor count.

Files:
- Create: `tmp/adult-downloader-wave-1-results.csv`
- Create: `docs/audits/adult-downloader-wave-1-capability-report.md`

Rules:
- Stop if block rate exceeds 30% and review user-agent/proxy strategy.
- Do not make live download claims until tested.
- Prioritize reusable extractor patterns.

Verification:

```bash
node scripts/probe-downloader-capability.mjs --top 50
```

---

## Task 9: Full 1,292-site classification

Objective: Classify the whole adult CSV after the probe harness is stable.

Files:
- Create: `tmp/adult-downloader-all-capability-results.csv`
- Create: `data/downloader-capabilities.adult.json`
- Create: `docs/audits/adult-downloader-full-capability-report.md`

Verification:

```bash
node scripts/probe-downloader-capability.mjs --all --concurrency 2 --delay-ms 1000
python3 - <<'PY'
import csv
rows=list(csv.DictReader(open('tmp/adult-downloader-all-capability-results.csv')))
assert len(rows) == 1292
print('rows', len(rows))
PY
```

---

## Task 10: Launch rules

Objective: Prevent publishing misleading pages.

Rules:

```text
web_download_verified -> can say web download works
works_with_ytdlp -> can say web download available after local API test passes
works_with_simple_html_json_extractor -> can say web download available after extractor implemented and tested
needs_custom_extractor -> page may exist, but CTA should say extension recommended/support in progress
extension_only -> extension CTA only
blocked_or_dead -> do not publish without manual approval
manual_review -> do not publish without manual approval
```

Verification:

```bash
node scripts/validate-tools.mjs
pnpm -C apps/tools typecheck
pnpm -C apps/tools build
```

---

## Approval Boundaries

Do not do these without explicit approval:

```text
push to GitHub
publish/deploy to Vercel
change DNS
run high-concurrency crawling
download full adult media files
proxy competitor services as if they are ours
iframe competitor tools deceptively
```

---

## Immediate Recommendation

Start with Task 4 for Tube8 because we already confirmed:

```text
Tube8 exposes real MP4 and HLS variant URLs via public page metadata.
Vanilla yt-dlp fails.
Competitors tested mostly hand off to Dirpy or fail.
A custom extractor gives us a genuine working advantage.
```

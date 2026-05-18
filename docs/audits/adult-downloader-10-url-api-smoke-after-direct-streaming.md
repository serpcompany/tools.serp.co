# Adult downloader 10 URL API smoke after yt-dlp direct streaming

Change tested:

- `apps/tools/app/api/media-fetch/route.ts`
- Added yt-dlp metadata/direct URL resolution with `download: false` and `dumpSingleJson: true`.
- The API now streams the direct media URL instead of downloading the whole video to a temp file first.

Test added:

- `apps/tools/lib/media-fetch-ytdlp-direct.test.mjs`

Verification:

```text
node --test apps/tools/lib/media-fetch-ytdlp-direct.test.mjs
pnpm -C apps/tools typecheck
node scripts/validate-tools.mjs
```

All passed.

## 10 URL smoke

Input:

- `tmp/adult-downloader-sample-urls-offset-0-limit-25.csv`
- first 10 rows with discovered sample URLs

Runner:

- `scripts/smoke-api-download-10-urls.mjs`

Output:

- `tmp/adult-downloader-10-url-api-download-smoke.csv`

The smoke posts each URL to:

```text
POST http://localhost:3011/api/media-fetch/
{"mode":"video","url":"..."}
```

Each curl is capped at 25 seconds so we do not intentionally download multi-hundred-MB full videos during smoke testing. I counted a video as downloaded/working when the API returned HTTP 200 media headers and wrote non-zero media bytes.

## Result

Downloaded/started media streams: 5/10

| # | Site | Result | Bytes saved | Extension |
|---|---|---:|---:|---|
| 1 | tube8.com | failed | 74 | |
| 2 | porntube.com | downloaded | 572,382 | mp4 |
| 3 | hellporno.com | downloaded | 4,432,218 | mp4 |
| 4 | thumbzilla.com | failed | 79 | |
| 5 | alphaporno.com | failed | 300 | |
| 6 | slutload.com | failed | 145 | |
| 7 | sunporno.com | downloaded | 4,458,332 | mp4 |
| 8 | porn300.com | downloaded | 2,243,778 | mp4 |
| 9 | thothub.to | downloaded | 25,976,635 | mp4 |
| 10 | pornone.com | failed | 90 | |

## Failure reasons from response bodies

- `tube8.com`: yt-dlp unsupported for the automatically discovered sample URL `https://www.tube8.com/amateur/648309f/`.
- `thumbzilla.com`: yt-dlp unsupported for the tested embed URL.
- `alphaporno.com`: yt-dlp extractor could not extract video URL.
- `slutload.com`: Cloudflare anti-bot / 403.
- `pornone.com`: yt-dlp unsupported URL.

## Extra check on previous batch

I also reran the earlier rows 11-20 batch artifact:

- `tmp/adult-downloader-batch-10-api-download-smoke-after-direct.csv`

That batch had only 7 sample URLs discovered. After the direct-streaming fix:

```text
3/7 sample URLs downloaded/started
```

Working there:

- `thothub.to`
- `empflix.com`
- `analdin.com`

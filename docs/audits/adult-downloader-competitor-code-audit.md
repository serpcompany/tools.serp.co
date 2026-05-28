# Adult downloader competitor public-code audit

Generated from public HTML/JS only. No credentials, bypass, or private server code access.

Primary raw report:

- `tmp/competitor-code-audit/report.md`
- `tmp/competitor-code-audit/report.json`

## Bottom line

The competitors are mostly not shipping complete web-download backend code in browser JS. The actual extractors are usually server-side. But there are useful public implementations/protocols to copy/adapt.

## Best finds

### 1. Locoloader is the strongest code source

Public assets:

- `https://www.locoloader.com/assets/js/app.min.js?v=5-3-3`
- `https://github.com/locoloader/chrome-extension`

Local copies:

- `tmp/competitor-code-audit/locoloader_app.js`
- `tmp/competitor-code-audit/locoloader-chrome-extension/background.js`
- `tmp/competitor-code-audit/locoloader-chrome-extension/fetcher.js`
- `tmp/competitor-code-audit/locoloader-chrome-extension/content.js`

What it exposes:

- public supported-site API: `https://www.locoloader.com/api-supported-websites/`
- public extraction endpoint: `https://www.locoloader.com/api-extract/`
- client-side pre-extractors in `app.min.js`
- browser-extension logic for privileged tab fetches, header rewrites, and native downloads
- public Chrome extension source code

Important details:

- Supported public API currently returns 38 site regex groups.
- Adult matches found: `xvideos`, `eporner`, `xhamster`.
- No matches found for Tube8, Empflix, DrTuber, PornOXO, Analdin, PornOne, SpankWire.
- `api-extract` uses a public key formula and optional pre-extraction data.
- A naive Tube8 POST to `api-extract` just echoed the URL, so Tube8 is not a Locoloader win.

Conclusion: copy/adapt Locoloader extension/client architecture for supported sites and header-sensitive downloads. Do not expect it to solve all 1,292 adult domains.

### 2. Faceb exposes an API and says it uses yt-dlp

Public API shown in page copy:

```text
POST https://api.faceb.com/api/download
json: {"url":"URL"}
```

Observed result for Tube8 once:

```json
{
  "success": true,
  "source": "yt-dlp",
  "items": [...]
}
```

But subsequent batch calls returned:

```text
401 Unauthorized
{"error":"Unauthorized","success":false}
```

Their web flow uses:

```text
POST https://faceb.com/api/extract/
```

with CSRF/session. It returned HTML result cards for Tube8, but I hit rate limiting before fully parsing the download buttons.

Conclusion: Faceb appears to be using yt-dlp behind an API. It is useful evidence that direct yt-dlp URL extraction is the scalable path. The public API is not reliably free/unauthenticated.

### 3. Tube8Download / SavePorn / YesDownloader are mostly Dirpy wrappers

Tested endpoints:

```text
POST https://www.tube8download.net/vdownload/
POST https://yesdownloader.com/en1/vdownload/
POST https://www.xnxxvideodownload.com/vdownload/
```

For Tube8, they produced result pages whose actual download CTAs point to:

```text
https://dirpy.com/studio?url=<encoded>&affid=<affiliate>&utm_source=<source>&utm_medium=download
```

Conclusion: they are not doing their own direct download for Tube8; they are affiliate-routing to Dirpy.

### 4. DownloadTube / TubeOffline also route to Dirpy for Tube8

Previously tested:

```text
https://www.downloadtube.net/download/
https://www.tubeoffline.com/downloadFrom.php?host=Tube8&video=<url>
```

Both returned Dirpy fallback links for Tube8, not direct media.

### 5. PasteDownload appears mostly templated/fake for Tube8

Public form has rotating hidden tokens:

```text
token
tok1
tok2
tok3
tok4
cn
```

Posting the Tube8 sample back to the page returned the same SEO/template page with no usable result/download media.

Conclusion: not a useful backend/code source for Tube8.

### 6. Desktop/app products are not directly reusable as web backend

Examples:

- Jaksta
- JDownloader
- PPTube
- SaveTheVideo/VideoProc
- TubeNinja

They expose app downloads, marketing pages, or how-to pages, not public extractor APIs we can directly use in our server.

## What to copy/use

Priority source material:

1. Locoloader public extension and `app.min.js` extractor architecture.
2. Locoloader supported-sites API for coverage targeting.
3. Faceb API/form flow as evidence/pattern for yt-dlp-backed extraction.
4. Tube8Download/YesDownloader/DownloadTube/TubeOffline Dirpy fallback URL pattern for external fallback only.
5. Competitor result-page parsers where they return direct result buttons.

## What not to expect

Most competitor server-side extractor logic is not exposed. The browser usually gets only:

- form actions
- CSRF tokens
- endpoint URLs
- result HTML
- external fallback links
- extension helper code

## Next practical engineering path

1. Import/adapt Locoloader extension/source patterns for sites it supports: xvideos, eporner, xhamster first.
2. Implement competitor result parser for `/vdownload/` style pages, but classify Dirpy links as `external_fallback_available`, not `web_download_verified`.
3. Implement `yt-dlp` direct URL streaming. Faceb appears to use yt-dlp; our current bottleneck is that we download the full file before returning.
4. Keep Tube8 custom extractor because competitors tested mostly hand Tube8 to Dirpy.

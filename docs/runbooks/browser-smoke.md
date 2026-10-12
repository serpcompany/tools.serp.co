# Browser smoke test

`apps/tools/scripts/smoke-browser.mjs` drives the critical tools in Chromium
against a running Worker. CI runs it in two places:

- the `smoke` job of `.github/workflows/check.yml`, on every PR: it builds the
  Worker with the local config, applies every migration to a fresh local D1
  with Wrangler, starts `wrangler dev`, and runs the script with
  `--require-dashboard`, then the
  [canary sweep](tool-verification.md#canary-sweep) on the same Worker;
- the Deploy workflow, after each Staging deploy, through the staging Worker's
  `*.workers.dev` host. It never runs against Production.

## What it checks

- The home page renders the tool directory.
- PNG to JPG converts the sample PNG, and the download is a `.jpg` whose bytes
  start with the JPEG signature.
- HTML to Markdown converts pasted HTML.
- Each tool run sends a `tool_run_started` and a `tool_run_succeeded` with the
  same `runId`, no `tool_run_failed`, and the Worker returns 200 for every
  telemetry request.
- A telemetry request with `Sec-GPC: 1` gets a 204 (the route returns before
  storing anything).
- Documents to images (`lib/convert/document-images.ts`), with the files kept
  in the page instead of downloaded: `html-to-webp` converts
  `hostile-page.html` and `docx-to-jpeg` converts `hostile-links.docx` (in
  `benchmarks/fixtures/`) running none of their scripts, and after the upload
  no request leaves the browser for the file: none to this site outside
  `/_next/static/` and `/api/telemetry`, none to the fixtures' `example.net`
  hosts, and none from the sandboxed frame. A load the sandbox's policy
  refuses doesn't count, since it never leaves the browser. `docx-to-jpeg`
  then converts `sample-long-table.docx` to its four pages, reading each page
  as laid out before it's captured: the table's header row starts each page
  it runs onto, every cell sits on the columns' edges and under the header it
  names, and no row is missing a column.
- The Worker serves the self-hosted PDF font
  (`/vendor/fonts/dejavu/DejaVuSans.ttf`) with a font type and the bytes in
  `public/`. Table pages load it only for text outside Windows-1252, which no
  sweep fixture has.
- A dynamic Tool page requested with a Chrome user agent has its `<title>`,
  meta description and `rel=canonical` in `<head>`, not streamed into
  `<body>`.
- `/internal/tools/` lists both tools as `live`. It is read with a direct
  request, so the dashboard password is only sent to the Worker.

Requests to other origins (analytics, ads) are blocked, and the
`x-tools-serp-smoke-test` header is sent only to the Worker. On failure, CI
uploads screenshots, page text and the Worker log as the `smoke-failure`
artifact.

## Run it locally

Start a Worker with a dashboard token first:

```bash
pnpm -C apps/tools cf:build
pnpm -C apps/tools db:migrate:local
pnpm -C apps/tools exec wrangler dev --port 8787 --var INTERNAL_DASHBOARD_TOKEN:local-smoke
```

```bash
INTERNAL_DASHBOARD_TOKEN=local-smoke pnpm -C apps/tools smoke:browser --base-url http://localhost:8787
```

Without `INTERNAL_DASHBOARD_TOKEN` the dashboard step is skipped. The dashboard
step only proves this run's writes on a fresh D1: on a reused database, older
rows can satisfy it.

## Run it against a deployment

Every run writes real tool runs into that environment's D1, so use staging,
never production:

```bash
pnpm -C apps/tools smoke:browser --base-url https://staging.tools.serp.co
```

A deployment's `*.workers.dev` host works too: it 308s to the canonical host,
and the smoke-test header the script sends skips that redirect.

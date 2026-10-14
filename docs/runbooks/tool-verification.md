# Tool fixtures and verification

The inputs Tools are tested with, and the app checks that run outside
`pnpm check`: the render snapshot, which proves a refactor changed no page, and
the Tool sweep, which runs every converter and compressor. Paths are under
`apps/tools/`. [apps/tools/README.md](../../apps/tools/README.md) maps the app's other topics.

## Fixtures

Benchmark fixtures and their declared coverage live under `benchmarks/`. In
`benchmarks/fixture-matrix.json`, `formats` is keyed by input format and
records `ready` or `missing`; custom Tool fixtures live under `toolFixtures`. Fixtures are reusable inputs, not proof that a Tool works.

Make a fixture locally with a native tool (FFmpeg, ImageMagick, `iconutil`) or
as plain text, keep it small (video 320x240 for about a second, images 96x96),
and say in its `notes` how it was made. Before marking it `ready`, read it back
with something other than the app (`ffprobe`, `magick identify`, `file`, or the
format's spec) and name it in `notes`, so a failure is the Tool's, not the
fixture's. Don't download one unasked: a format
that can't be made locally stays `missing`, with the reason in `notes`, until
the owner approves an outside sample. Download an approved one into its own
empty directory, read it back there, and record its source URL and licence in
`notes`. A Tool whose output is text (a table
converter, or any Tool to TXT) also needs its fixture's data in `TEXT_MARKERS`
in `scripts/lib/tool-sweep.mjs`, or the sweep reports it as `no_fixture`; a
fixture can list several strings, and each must be in the output. Text a
fixture hides (`sample-sheets.xlsx`'s hidden sheet, row and column), listed in
`HIDDEN_TEXT` there, must not be. An
image or video fixture whose picture is a single colour (most are 96x96 solid
blue) needs its name in `ONE_COLOUR_FIXTURES` there, or the sweep fails its
Tools' image outputs as blank; a photo or drawing needs nothing.
`lib/tool-sweep.test.mjs` decodes each listed still image, and pins each
listed video, PDF and AI by hash, so a replaced one fails until it's read back
again. An input a format's Tools must refuse (a .bin that isn't a picture, a
copy-protected M4P) is listed in that format's `refusals`, with the telemetry
code and words of its message in `EXPECTED_REFUSALS` there. The
table converter page picks its input format from the file's extension, so a
table fixture needs one the page maps to its format: a `.sql` file switches a
MySQL page to SQL, so the MySQL fixture is a `.txt`.

## Deterministic checks

For deterministic verification from the repository root, run `pnpm test`.
Application-only checks are `pnpm -C apps/tools lint` and
`pnpm -C apps/tools typecheck`. Benchmark, browser, deployed-environment, and
network-backed checks are separate operations and must not be described as
part of the deterministic test result. [AGENTS.md](../../AGENTS.md#verification)
says which checks each kind of change needs.

## Render snapshot

`pnpm -C apps/tools render-snapshot snapshot --base-url <url> --out <dir>`
records every page, sitemap file and redirect a running Worker serves;
`render-snapshot diff <base> <head>` exits 1 if a refactor changed any of them.
Build both the same way; only `cf:build:production` covers ads and indexing.

## Tool sweep

`pnpm -C apps/tools tool-sweep --base-url http://localhost:8787` runs every
active converter and compressor Tool once in headless Chromium against a local
Worker (started as in [the browser smoke runbook](browser-smoke.md)), checks
each saved file with `lib/convert/output-format.ts` and writes
`benchmarks/tool-sweep-results.json`. An image output of a fixture with more
than one colour is also decoded, in Node with the app's ImageMagick WASM
build, and fails as blank when its top colour covers 99.9% of the pixels
(within 8 of 255 a channel), or when it doesn't decode; its pass records that
share as `topColourShare`. An output the sweep didn't read the bytes of fails
as a harness error rather than passing unchecked. ICNS, KTX, KTX2, RGB, EPS and vector SVG outputs
aren't decoded; a raster SVG is checked through the image it wraps. A table
converter's Excel, PDF, Avro or Protobuf file is opened in Node the way an app
would (fflate, pdf.js, avsc, protobufjs with the `.proto` saved beside the
`.pb`) and must hold the fixture's data; its pass records `formatCheck:
"decoded"`. Its PNG and JPEG are checked as images. SVG to TTF's font is
opened with opentype.js and must have a glyph with an outline on U+E000, also
recorded as `"decoded"`. A fixture with several
pages, named in `PAGE_COUNTS` in `scripts/lib/tool-sweep.mjs`, must give an
image of each page, no more and no fewer. A converter page whose input format
has `refusals` is loaded again with each, and must show the expected message
rather than convert it or fail another way; otherwise its pass becomes an
error. The row records each refusal's message in `refusals`. Chromium runs with
`--enable-unsafe-swiftshader`, so DXF pages get WebGL on a machine with no
GPU, such as a CI runner. `--resume` continues an interrupted run;
`--summary` prints the Markdown table. It measures; it isn't part of
`pnpm check`. `--channel chrome` (or `msedge`) runs an installed Chrome or Edge
instead of Playwright's Chromium, whose codecs can differ (H.264, HEVC and AAC
are proprietary); each run records its channel and browser version. Each row
records the commit it was measured at, so `--only <ids>` re-measures some Tools
without touching the others. That commit can be a PR branch's, absent from
`staging` after a squash merge (the #224 rows record `ca5b9a5`); find it
through the PR.

After any sweep, run `pnpm -C apps/tools tool-status` and commit
`benchmarks/tool-status.csv` and `benchmarks/tool-status-summary.md` with the
results; `pnpm test` fails until the view matches them. The view joins the
sweep with the catalog and keyword demand (see
[ARCHITECTURE.md](../../ARCHITECTURE.md#canonical-sources-of-truth)).

Never hand-merge either file. On a conflict in `tool-sweep-results.json`, take
`staging`'s copy
(`git checkout origin/staging -- apps/tools/benchmarks/tool-sweep-results.json`),
re-measure your Tools against a local Worker with
`pnpm -C apps/tools tool-sweep --base-url <url> --only <your ids>`, then run
`pnpm -C apps/tools tool-status`. Leave out `--resume`: it skips every Tool that
already has a measured row, including the ones `staging`'s copy measured
before your change. On a conflict in the view alone, run `tool-status`.

## Canary sweep

`pnpm -C apps/tools tool-canary --base-url http://localhost:8787` runs the Tools
in `scripts/lib/tool-canary.mjs` through the sweep: one passing Tool for each
engine and each kind of page, each with the path it guards. It writes to a
temporary file, so the committed results are untouched, uses shorter timeouts
than the full sweep, and exits 1 if any canary doesn't pass. A canary that
fails runs once more, and a pass the second time is a warning; when most fail,
none runs again. CI runs it on every PR, after the
[browser smoke test](browser-smoke.md), in well under a minute. It catches a
broken engine, not a broken Tool: run the sweep with `--only` on the Tools a
change touches.

`pnpm test` fails when an engine or page the sweep can run has no canary and no
reason in `UNGUARDED`, or when a canary doesn't pass in
`tool-sweep-results.json`. A new engine needs a canary in the same PR. A Tool
the sweep can't run (no fixture yet) needs none.

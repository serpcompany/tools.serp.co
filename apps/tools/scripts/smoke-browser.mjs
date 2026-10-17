// Critical-path browser smoke test against a running Worker (local
// `wrangler dev` in CI, or a deployed environment). It converts real files in
// Chromium, checks the output format, checks that each tool run sends a
// started and a succeeded telemetry event that the Worker accepts, and reads
// the runs back from the internal dashboard.
//
//   INTERNAL_DASHBOARD_TOKEN=<token> node scripts/smoke-browser.mjs \
//     --base-url http://localhost:8787 [--require-dashboard] [--headed]
//
// Only requests to the base URL's origin are allowed; third-party scripts
// (analytics, ads) are blocked so runs don't depend on them or pollute them.

import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DOCUMENT_PAGE_EVENT } from "../lib/convert/document-images.ts";
import { PDF_FONT_URL } from "../lib/convert/table-outputs.ts";
import { PAGE_COUNTS } from "./lib/tool-sweep.mjs";

const { chromium } = await import("playwright");

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = JSON.parse(
  readFileSync(path.resolve(appRoot, "lib/catalog/tools.json"), "utf8"),
);
const homepageDownloaders = JSON.parse(
  readFileSync(path.resolve(appRoot, "lib/catalog/homepage-downloaders.json"), "utf8"),
);
// Deployed Workers skip their canonical-host redirect for requests with this
// header (issue #164), so the smoke test can run through *.workers.dev.
const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";
// The FFmpeg and ImageMagick steps load 32 MB and 14 MB of wasm.
const STEP_TIMEOUT_MS = 90_000;
// A failed step runs once more on a fresh page, so a slow runner or a
// deploy that is still rolling out doesn't fail the run. Both attempts are
// reported.
const STEP_ATTEMPTS = 2;
const TELEMETRY_TIMEOUT_MS = 10_000;
// The homepage's HTML ceiling: #317's 500 KB target, a quarter of the 2 MB
// Googlebot reads and about 4x the homepage's 122 KB today. Inlining the Tool
// index again (385 KB of JSON, more once escaped into the flight data) goes
// past it.
const HOME_HTML_MAX_BYTES = 500_000;
// A desktop Chrome visitor: not on Next's list of HTML-limited bots.
const CHROME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function parseArgs(argv) {
  const args = {
    baseUrl: "",
    requireDashboard: false,
    headed: false,
    artifactsDir: path.resolve("smoke-artifacts"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") args.baseUrl = argv[++index] ?? "";
    else if (arg === "--require-dashboard") args.requireDashboard = true;
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--artifacts-dir") args.artifactsDir = path.resolve(argv[++index] ?? "");
    else if (arg !== "--") throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.baseUrl) throw new Error("--base-url is required");
  args.baseUrl = args.baseUrl.replace(/\/$/, "");
  args.internalToken = process.env.INTERNAL_DASHBOARD_TOKEN || "";
  if (args.requireDashboard && !args.internalToken) {
    throw new Error("--require-dashboard needs INTERNAL_DASHBOARD_TOKEN");
  }
  return args;
}

function toolName(toolId) {
  const tool = tools.find((entry) => entry.id === toolId);
  if (!tool) throw new Error(`Unknown tool ${toolId}`);
  return tool.name;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const args = parseArgs(process.argv.slice(2));
const baseOrigin = new URL(args.baseUrl).origin;
const browser = await chromium.launch({ headless: !args.headed });
const context = await browser.newContext({ acceptDownloads: true });

// The FFmpeg wasm (32 MB) lives on the asset host, which can challenge CI
// runners; serve the same pinned file from the installed package instead.
const ffmpegWasmPath = path.resolve(appRoot, "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm");

await context.route("**/*", (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === "/vendor/ffmpeg-st/ffmpeg-core.wasm") {
    return route.fulfill({
      contentType: "application/wasm",
      headers: { "access-control-allow-origin": "*" },
      body: readFileSync(ffmpegWasmPath),
    });
  }
  if (url.origin !== baseOrigin) return route.abort();
  return route.continue({ headers: { ...request.headers(), [SMOKE_TEST_HEADER]: "1" } });
});

// Playwright can't read beacon bodies, so record each telemetry event the
// page sends.
await context.addInitScript(() => {
  const events = [];
  globalThis.__smokeTelemetry = events;
  const nav = globalThis.navigator;
  if (!nav?.sendBeacon) return;
  const send = nav.sendBeacon.bind(nav);
  nav.sendBeacon = (url, data) => {
    if (String(url).includes("/api/telemetry")) {
      new globalThis.Response(data)
        .text()
        .then((text) => events.push(JSON.parse(text)))
        .catch(() => {});
    }
    return send(url, data);
  };
});

const results = [];
const pageErrors = [];

async function saveFailureArtifacts(page, name) {
  try {
    mkdirSync(args.artifactsDir, { recursive: true });
    const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await page.screenshot({ path: path.join(args.artifactsDir, `${slug}.png`), fullPage: true });
    const text = await page.evaluate(() => globalThis.document.body?.innerText ?? "");
    writeFileSync(path.join(args.artifactsDir, `${slug}.txt`), `${page.url()}\n\n${text}`);
  } catch {
    // Artifacts are best effort; the step's own error is what matters.
  }
}

async function attemptStep(name, run) {
  const startedAt = Date.now();
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  const telemetryStatuses = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/telemetry") {
      telemetryStatuses.push(response.status());
    }
  });

  try {
    await run(page, telemetryStatuses);
    return { name, ok: true, ms: Date.now() - startedAt, errors };
  } catch (error) {
    await saveFailureArtifacts(page, name);
    return { name, ok: false, ms: Date.now() - startedAt, error: error.message, errors };
  } finally {
    await page.close().catch(() => {});
  }
}

async function step(name, run) {
  let result;
  for (let attempt = 1; attempt <= STEP_ATTEMPTS; attempt += 1) {
    result = await attemptStep(name, run);
    if (result.ok) break;
    // Page errors from a retried attempt (e.g. a chunk that vanished while a
    // deploy rolled out) are logged but don't fail the run.
    if (attempt < STEP_ATTEMPTS) {
      const details = [result.error, ...result.errors].join("\n      ");
      console.log(`retry ${name} (${result.ms} ms)\n      ${details}`);
    }
  }
  pageErrors.push(...result.errors);
  results.push(result);
  const mark = result.ok ? "pass" : "FAIL";
  console.log(`${mark}  ${name} (${result.ms} ms)${result.ok ? "" : `\n      ${result.error}`}`);
}

// Waits for one complete run of `toolId` on this page: a started and a
// succeeded event with the same runId, no failed event, and a 200 from the
// Worker for every telemetry request.
async function expectCompletedRun(page, telemetryStatuses, toolId) {
  const deadline = Date.now() + TELEMETRY_TIMEOUT_MS;
  let events = [];
  let started;
  let succeeded;
  while (Date.now() < deadline) {
    events = await page.evaluate(() => globalThis.__smokeTelemetry ?? []);
    started = events.find((e) => e.event === "tool_run_started" && e.toolId === toolId);
    succeeded =
      started && events.find((e) => e.event === "tool_run_succeeded" && e.runId === started.runId);
    if (succeeded && telemetryStatuses.length >= events.length) break;
    await sleep(100);
  }

  const summary = events.map((e) => `${e.event}:${e.toolId}`).join(", ") || "none";
  assert(succeeded, `no started + succeeded run for ${toolId} (events: ${summary})`);
  assert(
    !events.some((e) => e.event === "tool_run_failed"),
    `a tool_run_failed event was sent (events: ${summary})`,
  );
  assert(
    telemetryStatuses.length >= events.length,
    `the Worker answered ${telemetryStatuses.length} of ${events.length} telemetry requests`,
  );
  assert(
    telemetryStatuses.every((status) => status === 200),
    `telemetry statuses ${telemetryStatuses.join(",")}`,
  );
}

// The homepage shows a few Tools per category with a link to each category's
// pages, and the curated Downloaders in the file's order. Its HTML stays under
// HOME_HTML_MAX_BYTES, and only its search fetches /tool-index.json, which
// finds Tools the page doesn't show.
await step("home page links every category and the curated Downloaders, and only its search fetches the Tool index", async (page) => {
  let indexRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/tool-index.json") indexRequests += 1;
  });
  const response = await page.goto(`${args.baseUrl}/`);
  assert(response?.status() === 200, `status ${response?.status()}`);
  const htmlBytes = (await response.body()).length;
  assert(
    htmlBytes <= HOME_HTML_MAX_BYTES,
    `the homepage HTML is ${htmlBytes} B, over ${HOME_HTML_MAX_BYTES} B`,
  );
  const operations = new Set(tools.filter((tool) => tool.isActive).map((tool) => tool.operation));
  for (const operation of operations) {
    const link = page.locator(`section[aria-labelledby="home-${operation}"] a[href="/category/${operation}/"]`);
    assert((await link.count()) === 1, `the ${operation} section doesn't link /category/${operation}/`);
  }
  const downloaders = await page
    .locator('section[aria-labelledby="home-download"] .grid a')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  const curated = homepageDownloaders.landers.map(({ id }) => `${tools.find((tool) => tool.id === id)?.route}/`);
  assert(
    JSON.stringify(downloaders) === JSON.stringify(curated),
    `Downloaders ${downloaders.join(", ")}, expected ${curated.join(", ")}`,
  );
  assert(indexRequests === 0, `/tool-index.json was requested ${indexRequests} times before a search`);
  const search = page.getByPlaceholder("Search tools...");
  await search.fill(toolName("png-to-jpg"));
  await page
    .locator("section", { has: search })
    .getByRole("link", { name: toolName("png-to-jpg") })
    .first()
    .waitFor();
  assert(indexRequests === 1, `/tool-index.json was requested ${indexRequests} times by one search`);
});

await step("png-to-jpg converts a PNG into a real JPEG", async (page, telemetryStatuses) => {
  await page.goto(`${args.baseUrl}/png-to-jpg/`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(path.join(appRoot, "benchmarks/fixtures/sample.png")),
  ]);
  const bytes = readFileSync(await download.path());
  assert(download.suggestedFilename().endsWith(".jpg"), `filename ${download.suggestedFilename()}`);
  // JPEG files start with FF D8 FF.
  assert(
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    `not a JPEG: starts with ${bytes.subarray(0, 4).toString("hex")}`,
  );
  await expectCompletedRun(page, telemetryStatuses, "png-to-jpg");
});

await step("html-to-markdown converts pasted HTML", async (page, telemetryStatuses) => {
  await page.goto(`${args.baseUrl}/html-to-markdown/`);
  const output = page.getByPlaceholder(/Markdown will appear/);
  // The page converts its built-in sample once the WASM converter loads.
  await page.waitForFunction(
    (selector) => Boolean(globalThis.document.querySelector(selector)?.value),
    'textarea[placeholder^="Markdown will appear"]',
  );
  await page.getByPlaceholder(/Paste your HTML/).fill("<h1>Smoke</h1><p>A <b>bold</b> test</p>");
  await page.waitForFunction(
    (selector) => globalThis.document.querySelector(selector)?.value.includes("# Smoke"),
    'textarea[placeholder^="Markdown will appear"]',
  );
  const markdown = await output.inputValue();
  assert(markdown.includes("**bold**"), `unexpected markdown: ${JSON.stringify(markdown)}`);
  // The page sends at most one run per 10 s, for the sample or the pasted
  // input, whichever settles first.
  await expectCompletedRun(page, telemetryStatuses, "html-to-markdown");
});

await step("telemetry ignores requests with Global Privacy Control", async () => {
  // A direct request: the browser check in the client already sends nothing.
  const response = await context.request.post(`${args.baseUrl}/api/telemetry`, {
    headers: { "sec-gpc": "1", "content-type": "application/json", [SMOKE_TEST_HEADER]: "1" },
    data: { event: "tool_run_started", runId: "smoke-gpc", toolId: "png-to-jpg", startedAt: new Date().toISOString() },
    maxRedirects: 0,
  });
  assert(response.status() === 204, `status ${response.status()}`);
});

await step("a dynamic tool page serves its title, description and canonical in <head>", async () => {
  // Next streams metadata into <body> when a dynamic page's RSC payload
  // outruns it; htmlLimitedBots in next.config.mjs keeps it blocking for every
  // user agent. /avchd-to-mkv/ is one of the [tool] pages that streamed.
  const response = await context.request.get(`${args.baseUrl}/avchd-to-mkv/`, {
    headers: { "user-agent": CHROME_USER_AGENT, [SMOKE_TEST_HEADER]: "1" },
    maxRedirects: 0,
  });
  assert(response.status() === 200, `status ${response.status()}`);
  const html = await response.text();
  const headEnd = html.indexOf("</head>");
  assert(headEnd !== -1, "no </head>");
  const head = html.slice(0, headEnd);
  for (const tag of ["<title>", '<meta name="description"', '<link rel="canonical"']) {
    assert(head.includes(tag), `${tag} is not in <head>`);
  }
});

await step("the Worker serves the self-hosted PDF font", async () => {
  // Table pages fetch it only for a PDF with text outside Windows-1252
  // (lib/convert/table-outputs.ts); the sweep's fixtures are Latin, so this
  // is the request that proves it's served.
  const response = await context.request.get(`${args.baseUrl}${PDF_FONT_URL}`, {
    headers: { [SMOKE_TEST_HEADER]: "1" },
    maxRedirects: 0,
  });
  assert(response.status() === 200, `status ${response.status()}`);
  const type = response.headers()["content-type"] ?? "";
  assert(/^(font\/(ttf|sfnt)|application\/(font-sfnt|x-font-ttf))\b/.test(type), `content-type ${type}`);
  const served = await response.body();
  const expected = readFileSync(path.join(appRoot, "public", PDF_FONT_URL));
  assert(served.equals(expected), `served ${served.length} bytes, not the ${expected.length} bytes of public${PDF_FONT_URL}`);
});

await step("webm-to-mp3 converts with FFmpeg in the browser", async (page, telemetryStatuses) => {
  await page.goto(`${args.baseUrl}/webm-to-mp3/`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(path.join(appRoot, "benchmarks/fixtures/sample.webm")),
  ]);
  const bytes = readFileSync(await download.path());
  assert(download.suggestedFilename().endsWith(".mp3"), `filename ${download.suggestedFilename()}`);
  // MP3 files start with an ID3 tag or an MPEG frame sync (FF Ex/Fx).
  const isMp3 =
    bytes.subarray(0, 3).toString("latin1") === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  assert(isMp3, `not an MP3: starts with ${bytes.subarray(0, 4).toString("hex")}`);
  await expectCompletedRun(page, telemetryStatuses, "webm-to-mp3");
});

// Converts a fixture with a tool and returns the downloaded bytes.
async function convertFixture(page, toolId, fixture, extension) {
  await page.goto(`${args.baseUrl}/${toolId}/`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('input[type="file"]').first().setInputFiles(path.join(appRoot, "benchmarks/fixtures", fixture)),
  ]);
  assert(download.suggestedFilename().endsWith(`.${extension}`), `filename ${download.suggestedFilename()}`);
  return readFileSync(await download.path());
}

await step("dng-to-jpg decodes camera RAW with ImageMagick in the browser", async (page, telemetryStatuses) => {
  const bytes = await convertFixture(page, "dng-to-jpg", "sample.dng", "jpg");
  assert(
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    `not a JPEG: starts with ${bytes.subarray(0, 4).toString("hex")}`,
  );
  await expectCompletedRun(page, telemetryStatuses, "dng-to-jpg");
});

await step("png-to-gif writes a real GIF, not a relabelled PNG", async (page, telemetryStatuses) => {
  const bytes = await convertFixture(page, "png-to-gif", "sample.png", "gif");
  assert(bytes.subarray(0, 4).toString("latin1") === "GIF8", `not a GIF: starts with ${bytes.subarray(0, 4).toString("hex")}`);
  await expectCompletedRun(page, telemetryStatuses, "png-to-gif");
});

// ------------------------------------------------ documents to images --
// DOCX and HTML files are laid out as pages in a sandboxed iframe and
// captured (lib/convert/document-images.ts). These steps keep the files the
// converter saves in the page instead of downloading them, and record what
// it lays out before each DOCX page is captured (the page dispatches
// DOCUMENT_PAGE_EVENT on window with the page's element).

async function watchDocumentConversion(page) {
  await page.addInitScript((eventName) => {
    const saved = [];
    const pages = [];
    globalThis.__smokeSaved = saved;
    globalThis.__smokeDocumentPages = pages;
    const blobs = new Map();
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = createObjectURL(object);
      if (object instanceof Blob) blobs.set(url, object);
      return url;
    };
    const anchor = globalThis.HTMLAnchorElement.prototype;
    const click = anchor.click;
    anchor.click = function keepDownload() {
      const blob = this.hasAttribute("download") ? blobs.get(this.href) : undefined;
      if (!blob) return click.call(this);
      const name = this.download;
      blob.arrayBuffer().then((buffer) => {
        saved.push({ name, size: buffer.byteLength, head: Array.from(new Uint8Array(buffer.slice(0, 12))) });
      });
    };
    // Each table's shown cells, with their box relative to the page.
    globalThis.addEventListener(eventName, (event) => {
      const section = event.detail;
      const view = section.ownerDocument.defaultView;
      const origin = section.getBoundingClientRect();
      const tables = Array.from(section.querySelectorAll("table"), (table) =>
        Array.from(table.rows, (row) =>
          Array.from(row.cells)
            .filter((cell) => view.getComputedStyle(cell).display !== "none")
            .map((cell) => {
              const box = cell.getBoundingClientRect();
              return {
                text: cell.textContent.trim(),
                left: box.left - origin.left,
                right: box.right - origin.left,
                top: box.top - origin.top,
                bottom: box.bottom - origin.top,
              };
            }),
        ),
      );
      pages.push({ height: origin.height, tables });
    });
  }, DOCUMENT_PAGE_EVENT);
}

// Uploads a fixture on `toolId`'s page and waits for the run to finish;
// returns the files it saved.
async function convertInPage(page, telemetryStatuses, toolId, fixture, expectedFiles) {
  await page.locator('input[type="file"]').first().setInputFiles(path.join(appRoot, "benchmarks/fixtures", fixture));
  await expectCompletedRun(page, telemetryStatuses, toolId);
  let saved = [];
  for (const deadline = Date.now() + TELEMETRY_TIMEOUT_MS; Date.now() < deadline; await sleep(100)) {
    saved = await page.evaluate(() => globalThis.__smokeSaved);
    if (saved.length >= expectedFiles) break;
  }
  assert(saved.length === expectedFiles, `saved ${saved.length} files, expected ${expectedFiles}`);
  return saved;
}

const isJpeg = (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
const isWebp = (head) =>
  String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP";

// The hostile fixtures point every URL at /hostile/ on this site or at a
// host under example.net, and their scripts and event handlers set
// __hostileRan on this page. After the upload, a request that leaves the
// browser fails the step when it goes to this site outside the app's chunks
// (/_next/static/) and telemetry (Next's own route prefetches, sent with an
// `rsc` header, aside), to example.net, or from a frame other than the page
// to any host. Other hosts the page itself asks for are its ads, which the
// route above blocks; they aren't the file's. Loads the sandbox's policy
// refuses never leave the browser, so they never reach a route; the page's
// "request" event would count them too.
async function watchRequests(page) {
  // The page's own loading is done before the upload.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const unexpected = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let frame = "the page";
    try {
      if (request.frame() !== page.mainFrame()) frame = `a frame at ${request.frame().url().slice(0, 60)}`;
    } catch {
      // A request no frame made (a service worker's).
    }
    const allowed =
      frame === "the page" &&
      (url.origin === baseOrigin
        ? url.pathname.startsWith("/_next/static/") || url.pathname === "/api/telemetry" || request.headers().rsc === "1"
        : !/(^|\.)example\.net$/.test(url.hostname));
    if (!allowed) unexpected.push(`${request.method()} ${request.url()} (from ${frame})`);
    return route.fallback();
  });
  return unexpected;
}

async function expectNothingRanOrLoaded(page, unexpected) {
  // A fetch the capture starts late still shows up.
  await sleep(1_000);
  assert(!unexpected.length, `requested what the file named:\n        ${unexpected.join("\n        ")}`);
  const ran = await page.evaluate(() => globalThis.__hostileRan);
  assert(ran === undefined, `the file's script ran (${ran})`);
}

await step("html-to-webp runs none of a hostile page's scripts and loads none of its URLs", async (page, telemetryStatuses) => {
  await watchDocumentConversion(page);
  await page.goto(`${args.baseUrl}/html-to-webp/`);
  const unexpected = await watchRequests(page);
  const [saved] = await convertInPage(page, telemetryStatuses, "html-to-webp", "hostile-page.html", 1);
  assert(isWebp(saved.head), `not a WebP: starts with ${Buffer.from(saved.head).toString("hex")}`);
  await expectNothingRanOrLoaded(page, unexpected);
});

await step("docx-to-jpeg loads none of a DOCX's linked or missing pictures", async (page, telemetryStatuses) => {
  await watchDocumentConversion(page);
  await page.goto(`${args.baseUrl}/docx-to-jpeg/`);
  const unexpected = await watchRequests(page);
  const [saved] = await convertInPage(page, telemetryStatuses, "docx-to-jpeg", "hostile-links.docx", 1);
  assert(isJpeg(saved.head), `not a JPEG: starts with ${Buffer.from(saved.head).toString("hex")}`);
  await expectNothingRanOrLoaded(page, unexpected);
});

// Graphviz and pptx-glimpse lay a file out in a worker (#265); its scripts
// load from /_next/static/, and a file the graph or a slide names loads from
// nowhere.
const isPng = (head) => head[0] === 0x89 && String.fromCharCode(...head.slice(1, 4)) === "PNG";

await step("dot-to-png loads none of the files and URLs a hostile graph names", async (page, telemetryStatuses) => {
  await watchDocumentConversion(page);
  await page.goto(`${args.baseUrl}/dot-to-png/`);
  const unexpected = await watchRequests(page);
  const [saved] = await convertInPage(page, telemetryStatuses, "dot-to-png", "hostile-graph.dot", 1);
  assert(isPng(saved.head), `not a PNG: starts with ${Buffer.from(saved.head).toString("hex")}`);
  await expectNothingRanOrLoaded(page, unexpected);
});

await step("pptx-to-jpg loads none of a slide's linked pictures or links", async (page, telemetryStatuses) => {
  await watchDocumentConversion(page);
  await page.goto(`${args.baseUrl}/pptx-to-jpg/`);
  const unexpected = await watchRequests(page);
  const [saved] = await convertInPage(page, telemetryStatuses, "pptx-to-jpg", "hostile-links.pptx", 1);
  assert(isJpeg(saved.head), `not a JPEG: starts with ${Buffer.from(saved.head).toString("hex")}`);
  await expectNothingRanOrLoaded(page, unexpected);
});

// The columns a table's header row names, left to right, on the first page
// that shows the table.
const LONG_TABLE_COLUMNS = ["GROUP", "ITEM", "PRICE"];

// Every table part on every page: the header row first, each cell's edges
// on column edges, each label in the column it names ("Item 24" under ITEM;
// a cell spanning columns starts in the one it names), and no row missing a
// column.
function checkLongTablePages(pages) {
  const header = pages.flatMap((page) => page.tables).find((rows) => rows[0]?.[0]?.text === "GROUP")?.[0];
  assert(header?.length === LONG_TABLE_COLUMNS.length, "no GROUP | ITEM | PRICE header row");
  const columns = header.map((cell) => ({ name: cell.text, left: cell.left, right: cell.right }));
  const edges = [columns[0].left, ...columns.map((column) => column.right)];
  const onEdge = (x) => edges.some((edge) => Math.abs(edge - x) <= 1.5);
  let parts = 0;
  pages.forEach((page, pageIndex) => {
    for (const rows of page.tables) {
      if (!rows.length) continue;
      parts += 1;
      const where = `page ${pageIndex + 1}`;
      assert(
        rows[0].map((cell) => cell.text).join("|") === LONG_TABLE_COLUMNS.join("|"),
        `${where}: the table part starts with "${rows[0].map((cell) => cell.text).join(" | ")}", not its header row`,
      );
      const cells = rows.flat();
      for (const cell of cells) {
        assert(onEdge(cell.left) && onEdge(cell.right), `${where}: "${cell.text}" isn't on the columns' edges`);
        const word = cell.text.split(" ")[0]?.toUpperCase();
        const column = columns.find((candidate) => cell.left >= candidate.left - 1.5 && cell.left < candidate.right - 1.5);
        if (word && LONG_TABLE_COLUMNS.includes(word)) {
          assert(column?.name === word, `${where}: "${cell.text}" is under ${column?.name ?? "no column"}`);
        }
      }
      for (const row of rows) {
        // A row ends where its shortest cell does: a merged cell runs on below.
        const middle = (Math.min(...row.map((cell) => cell.top)) + Math.min(...row.map((cell) => cell.bottom))) / 2;
        for (const column of columns) {
          const x = (column.left + column.right) / 2;
          const covered = cells.some((cell) => cell.left <= x && x <= cell.right && cell.top <= middle && middle <= cell.bottom);
          assert(covered, `${where}: the row with "${row[0].text}" has no cell under ${column.name}`);
        }
      }
    }
  });
  return parts;
}

await step("docx-to-jpeg continues a long table on the next pages, each cell under its header", async (page, telemetryStatuses) => {
  const fixture = "sample-long-table.docx";
  const expected = PAGE_COUNTS[fixture];
  await watchDocumentConversion(page);
  await page.goto(`${args.baseUrl}/docx-to-jpeg/`);
  const saved = await convertInPage(page, telemetryStatuses, "docx-to-jpeg", fixture, expected);
  assert(saved.every((file) => isJpeg(file.head)), "a page isn't a JPEG");
  const pages = await page.evaluate(() => globalThis.__smokeDocumentPages);
  assert(pages.length === expected, `laid out ${pages.length} pages, expected ${expected}`);
  const parts = checkLongTablePages(pages);
  assert(parts >= 3, `the table is on ${parts} pages, expected it to run over at least 3`);
});

// Each tool's row in the dashboard's status table must say `live`.
function assertLiveRows(body) {
  const rows = body.split("<tr");
  for (const toolId of ["png-to-jpg", "html-to-markdown"]) {
    const row = rows.find((chunk) => chunk.includes(`>${toolName(toolId)}</div>`));
    assert(row, `no status row for ${toolId}`);
    assert(row.includes(">live</span>"), `${toolId} status is not live`);
  }
}

if (args.internalToken) {
  await step("internal dashboard shows both tools as live", async () => {
    // A direct request, not a page: no subresources load, so the password is
    // only ever sent to the Worker.
    const authorization = `Basic ${Buffer.from(`smoke:${args.internalToken}`).toString("base64")}`;
    const response = await context.request.get(`${args.baseUrl}/internal/tools/`, {
      headers: { authorization, [SMOKE_TEST_HEADER]: "1" },
      maxRedirects: 0,
    });
    const body = await response.text();
    try {
      assert(response.status() === 200, `status ${response.status()}`);
      assertLiveRows(body);
    } catch (error) {
      // The page holds no secret; keep it for diagnosis.
      mkdirSync(args.artifactsDir, { recursive: true });
      writeFileSync(
        path.join(args.artifactsDir, "internal-dashboard.html"),
        `<!-- status ${response.status()} -->\n${body}`,
      );
      throw error;
    }
  });
}

await browser.close();

if (pageErrors.length) {
  console.log(`\nPage errors:\n${pageErrors.map((error) => `  ${error}`).join("\n")}`);
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed || pageErrors.length ? 1 : 0);

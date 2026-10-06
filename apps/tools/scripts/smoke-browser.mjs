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

const { chromium } = await import("playwright");

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = JSON.parse(
  readFileSync(path.resolve(appRoot, "../../packages/app-core/src/data/tools.json"), "utf8"),
);
// Deployed Workers skip their canonical-host redirect for requests with this
// header (issue #164), so the smoke test can run through *.workers.dev.
const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";
const STEP_TIMEOUT_MS = 60_000;
const TELEMETRY_TIMEOUT_MS = 10_000;

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

async function step(name, run) {
  const startedAt = Date.now();
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.on("pageerror", (error) => pageErrors.push(`${name}: ${error.message}`));
  const telemetryStatuses = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/telemetry") {
      telemetryStatuses.push(response.status());
    }
  });

  let result;
  try {
    await run(page, telemetryStatuses);
    result = { name, ok: true, ms: Date.now() - startedAt };
  } catch (error) {
    result = { name, ok: false, ms: Date.now() - startedAt, error: error.message };
    await saveFailureArtifacts(page, name);
  } finally {
    await page.close();
  }
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

await step("home page renders the tool directory", async (page) => {
  const response = await page.goto(`${args.baseUrl}/`);
  assert(response?.status() === 200, `status ${response?.status()}`);
  await page.getByRole("link", { name: toolName("png-to-jpg") }).first().waitFor();
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

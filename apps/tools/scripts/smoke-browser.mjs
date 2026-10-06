// Critical-path browser smoke test against a running Worker (local
// `wrangler dev` in CI, or a deployed environment). It converts real files in
// Chromium, checks the output format, and checks that telemetry reaches D1 and
// shows up on the internal dashboard.
//
//   node scripts/smoke-browser.mjs --base-url http://localhost:8787 \
//     [--internal-token <token>] [--headed]

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import("playwright");

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = JSON.parse(
  readFileSync(path.resolve(appRoot, "../../packages/app-core/src/data/tools.json"), "utf8"),
);
// Must match SMOKE_TEST_HEADER in lib/site-environment.ts.
const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";
const STEP_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const args = {
    baseUrl: "",
    internalToken: process.env.INTERNAL_DASHBOARD_TOKEN || "",
    headed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") args.baseUrl = argv[++index] ?? "";
    else if (arg === "--internal-token") args.internalToken = argv[++index] ?? "";
    else if (arg === "--headed") args.headed = true;
    else if (arg !== "--") throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.baseUrl) throw new Error("--base-url is required");
  args.baseUrl = args.baseUrl.replace(/\/$/, "");
  return args;
}

function toolName(toolId) {
  const tool = tools.find((entry) => entry.id === toolId);
  if (!tool) throw new Error(`Unknown tool ${toolId}`);
  return tool.name;
}

const args = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({ headless: !args.headed });
const context = await browser.newContext({
  acceptDownloads: true,
  extraHTTPHeaders: { [SMOKE_TEST_HEADER]: "1" },
});

const telemetry = [];
const pageErrors = [];
context.on("response", (response) => {
  if (new URL(response.url()).pathname === "/api/telemetry") {
    telemetry.push({ status: response.status(), url: response.url() });
  }
});

const results = [];
async function step(name, run) {
  const startedAt = Date.now();
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.on("pageerror", (error) => pageErrors.push(`${name}: ${error.message}`));
  let result;
  try {
    await run(page);
    result = { name, ok: true, ms: Date.now() - startedAt };
  } catch (error) {
    result = { name, ok: false, ms: Date.now() - startedAt, error: error.message };
  } finally {
    await page.close();
  }
  results.push(result);
  const mark = result.ok ? "pass" : "FAIL";
  console.log(`${mark}  ${name} (${result.ms} ms)${result.ok ? "" : `\n      ${result.error}`}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// A tool run sends two beacons, started and then succeeded. Playwright can't
// read beacon bodies, so count the responses after `before` and require 200s;
// the dashboard step then confirms the completed runs reached D1.
async function expectRunTelemetry(before) {
  const deadline = Date.now() + 10_000;
  while (telemetry.length < before + 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const events = telemetry.slice(before);
  assert(events.length >= 2, `expected 2 telemetry events, got ${events.length}`);
  assert(
    events.every((event) => event.status === 200),
    `telemetry statuses ${events.map((event) => event.status).join(",")}`,
  );
}

await step("home page renders the tool directory", async (page) => {
  const response = await page.goto(`${args.baseUrl}/`);
  assert(response?.status() === 200, `status ${response?.status()}`);
  await page.getByRole("link", { name: toolName("png-to-jpg") }).first().waitFor();
});

await step("png-to-jpg converts a PNG into a real JPEG", async (page) => {
  await page.goto(`${args.baseUrl}/png-to-jpg/`);
  const before = telemetry.length;
  const download = page.waitForEvent("download");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.join(appRoot, "benchmarks/fixtures/sample.png"));
  const file = await download;
  const bytes = readFileSync(await file.path());
  assert(file.suggestedFilename().endsWith(".jpg"), `filename ${file.suggestedFilename()}`);
  // JPEG files start with FF D8 FF.
  assert(
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    `not a JPEG: starts with ${bytes.subarray(0, 4).toString("hex")}`,
  );
  await expectRunTelemetry(before);
});

await step("html-to-markdown converts pasted HTML", async (page) => {
  await page.goto(`${args.baseUrl}/html-to-markdown/`);
  const before = telemetry.length;
  await page.getByPlaceholder(/Paste your HTML/).fill("<h1>Smoke</h1><p>A <b>bold</b> test</p>");
  const output = page.getByPlaceholder(/Markdown will appear/);
  await output.waitFor();
  await page.waitForFunction(
    (selector) => globalThis.document.querySelector(selector)?.value.includes("# Smoke"),
    'textarea[placeholder^="Markdown will appear"]',
  );
  const markdown = await output.inputValue();
  assert(markdown.includes("**bold**"), `unexpected markdown: ${JSON.stringify(markdown)}`);
  await expectRunTelemetry(before);
});

if (args.internalToken) {
  await step("internal dashboard reads the recorded runs", async (page) => {
    const authorization = `Basic ${Buffer.from(`smoke:${args.internalToken}`).toString("base64")}`;
    await page.setExtraHTTPHeaders({ [SMOKE_TEST_HEADER]: "1", authorization });
    const response = await page.goto(`${args.baseUrl}/internal/tools/`);
    assert(response?.status() === 200, `status ${response?.status()}`);
    // tool_status rows only exist for completed runs.
    for (const toolId of ["png-to-jpg", "html-to-markdown"]) {
      await page.getByText(toolName(toolId), { exact: true }).first().waitFor();
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

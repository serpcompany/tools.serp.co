// Tool sweep (issue #147): runs every active converter and compressor Tool
// once in headless Chromium against a local Worker, feeds it the fixture for
// its input format, captures what it saves and checks the bytes with the
// app's own output-format check (lib/convert/output-format.ts). Each Tool
// gets a status: pass, wrong_format, error, timeout, no_fixture or skipped.
//
//   node scripts/tool-sweep.mjs --base-url http://localhost:8787 \
//     [--out benchmarks/tool-sweep-results.json] [--concurrency 4] \
//     [--timeout 60000] [--ffmpeg-timeout 180000] [--only id,id] [--limit n] \
//     [--resume [--retry error,timeout]] [--headed]
//   node scripts/tool-sweep.mjs --summary [--out <file>]
//
// Results are written after every Tool, so --resume carries on after a crash
// or interrupt instead of starting over. A run merges its rows into --out and
// keeps the rows of Tools it didn't run. Downloads never reach the disk: the
// page's saveBlob() is captured in the page. Requests to other origins are
// blocked, and the FFmpeg wasm (on the asset host in deployments) is served
// from the installed package, as in smoke-browser.mjs. Only a local Worker is
// accepted: every run writes telemetry into the target's D1.

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { activeTools, toolHref } from "../lib/catalog/catalog.ts";
import { SMOKE_TEST_HEADER } from "../lib/site-environment.ts";
import {
  classifyRun,
  countStatuses,
  ffmpegError,
  loadFixtures,
  mergeRows,
  parseArgs,
  planTool,
  renderSummary,
  scanPageHandlers,
  selectRuns,
  serializeResults,
} from "./lib/tool-sweep.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAVIGATION_TIMEOUT_MS = 30_000;
const HYDRATION_TIMEOUT_MS = 20_000;

const args = parseArgs(process.argv.slice(2));
const outPath = path.resolve(appRoot, args.out);
const tools = activeTools();

function readResults() {
  if (!existsSync(outPath)) return null;
  return JSON.parse(readFileSync(outPath, "utf8"));
}

if (args.summary) {
  const results = readResults();
  if (!results) throw new Error(`No results at ${outPath}`);
  process.stdout.write(renderSummary(results, { activeCount: tools.length }));
  process.exit(0);
}

function git(...gitArgs) {
  const result = spawnSync("git", gitArgs, { cwd: appRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

const fixtures = loadFixtures(path.join(appRoot, "benchmarks"));
const handlers = scanPageHandlers(path.join(appRoot, "app"));
const selectedTools = args.only ? tools.filter((tool) => args.only.includes(tool.id)) : tools;
if (args.only) {
  const unknown = args.only.filter((id) => !tools.some((tool) => tool.id === id));
  if (unknown.length) throw new Error(`Not active Tool ids: ${unknown.join(", ")}`);
}
const plans = selectedTools.map((tool) =>
  planTool(tool, { handlers, fixtures, timeoutMs: args.timeoutMs, ffmpegTimeoutMs: args.ffmpegTimeoutMs }),
);
const previous = readResults();
const previousRows = previous?.results ?? [];
const runnable = plans.filter((plan) => !plan.status);
const toRun = selectRuns(runnable, previousRows, args);
const commit = git("rev-parse", "HEAD");
// Uncommitted changes outside the results file mean the harness or the app
// differs from the recorded commit.
const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: appRoot, encoding: "utf8" })
  .stdout.split("\n")
  .some((line) => line.trim() && !outPath.endsWith(line.slice(3).replace(/\.tmp$/, "")));
if (previous?.meta?.commit && previous.meta.commit !== commit) {
  console.warn(`note: ${path.relative(appRoot, outPath)} was measured at ${previous.meta.commit}; HEAD is ${commit}`);
}

// Rows for Tools that never open a page are written as they are planned.
const planRows = plans.filter((plan) => plan.status).map((plan) => toRow(plan, { status: plan.status }));
const newRows = [...planRows];
const startedAt = new Date();
const runEntry = {
  commit,
  dirty,
  startedAt: startedAt.toISOString(),
  finishedAt: null,
  wallMs: 0,
  measured: 0,
  concurrency: args.concurrency,
  timeoutMs: args.timeoutMs,
  ffmpegTimeoutMs: args.ffmpegTimeoutMs,
  ...(args.only ? { only: args.only } : {}),
  ...(args.limit ? { limit: args.limit } : {}),
  ...(args.resume ? { resume: true, retry: [...args.retry] } : {}),
};

function toRow(plan, result) {
  return {
    id: plan.id,
    route: plan.route,
    from: plan.from,
    to: plan.to,
    handler: plan.handler,
    engine: plan.engine,
    status: result.status,
    durationMs: result.durationMs,
    error: result.error ?? undefined,
    detail: result.detail,
    formatCheck: result.formatCheck,
    fixture: plan.fixtures?.map((file) => path.basename(file)).join(","),
    output: result.output,
    blocked: result.blocked?.length ? result.blocked : undefined,
    reason: plan.reason,
  };
}

function writeResults() {
  const results = mergeRows(
    tools.map((tool) => tool.id),
    previousRows,
    newRows,
  );
  runEntry.finishedAt = new Date().toISOString();
  runEntry.wallMs = Date.now() - startedAt.getTime();
  const meta = {
    issue: "https://github.com/serpcompany/tools.serp.co/issues/147",
    command: "pnpm -C apps/tools tool-sweep",
    baseUrl: args.baseUrl,
    commit,
    activeTools: tools.length,
    counts: countStatuses(results),
    runs: [...(previous?.meta?.runs ?? []), runEntry],
  };
  const temporary = `${outPath}.tmp`;
  writeFileSync(temporary, serializeResults({ meta, results }));
  renameSync(temporary, outPath);
}

const { chromium } = await import("playwright");
const ffmpegWasm = readFileSync(path.resolve(appRoot, "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm"));
const baseOrigin = new URL(args.baseUrl).origin;

// The full Chromium build in new headless mode, the browser visitors run.
// (The default headless shell was killed about 30 s after launch on the
// machine that recorded the first results.) A lost browser is relaunched and
// the Tools that were running on it run again; see measureWithRetry.
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    const launching = chromium.launch({ channel: "chromium", headless: !args.headed }).then((browser) => {
      browser.on("disconnected", () => {
        if (browserPromise === launching) browserPromise = null;
      });
      return browser;
    });
    browserPromise = launching;
  }
  return browserPromise;
}
const BROWSER_ATTEMPTS = 3;

// Installed in every page before its scripts run. saveBlob() (components/
// saveAs.ts) and the custom download buttons create a blob URL and click an
// anchor with a download attribute: keep the blob and skip the download.
// Telemetry beacons are recorded the way smoke-browser.mjs records them.
function installCapture() {
  const state = { outputs: [], telemetry: [], terminalSeenAt: null };
  globalThis.__sweep = state;
  const blobs = new Map();
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (object) => {
    const url = createObjectURL(object);
    if (object instanceof Blob) blobs.set(url, object);
    return url;
  };
  const anchor = globalThis.HTMLAnchorElement.prototype;
  const click = anchor.click;
  anchor.click = function captureDownload() {
    const blob = this.hasAttribute("download") ? blobs.get(this.href) : undefined;
    if (blob) {
      state.outputs.push({ name: this.download, blob });
      return undefined;
    }
    return click.call(this);
  };
  const nav = globalThis.navigator;
  if (nav?.sendBeacon) {
    const send = nav.sendBeacon.bind(nav);
    nav.sendBeacon = (url, data) => {
      if (String(url).includes("/api/telemetry")) {
        new globalThis.Response(data)
          .text()
          .then((text) => state.telemetry.push(JSON.parse(text)))
          .catch(() => {});
      }
      return send(url, data);
    };
  }
}

class HarnessError extends Error {}

function isTimeout(error) {
  return error?.name === "TimeoutError";
}

// Waits for React to attach its handlers to the element, so a file set on
// it reaches the component's onChange.
async function waitForHydration(page, selector) {
  await page.waitForFunction(
    (target) => {
      const element = globalThis.document.querySelector(target);
      return Boolean(element) && Object.keys(element).some((key) => key.startsWith("__reactProps"));
    },
    selector,
    { timeout: HYDRATION_TIMEOUT_MS },
  );
}

async function setup(step, run) {
  try {
    return await run();
  } catch (error) {
    throw new HarnessError(`harness: ${step}: ${error.message.split("\n")[0]}`);
  }
}

async function readOutputs(page, { text = false, base64 = false } = {}) {
  return page.evaluate(
    async ({ withText, withBase64 }) =>
      Promise.all(
        globalThis.__sweep.outputs.map(async ({ name, blob }) => {
          const head = Array.from(new Uint8Array(await blob.slice(0, 1024).arrayBuffer()));
          const output = { name, size: blob.size, type: blob.type, head };
          if (withText) output.text = await blob.slice(0, 65_536).text();
          if (withBase64) {
            output.base64 = await new Promise((resolve, reject) => {
              const reader = new globalThis.FileReader();
              reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
          }
          return output;
        }),
      ),
    { withText: text, withBase64: base64 },
  );
}

async function waitForOutputs(page, count, timeout) {
  await page.waitForFunction((n) => globalThis.__sweep.outputs.length >= n, count, { timeout });
}

// The generic converter and compressor (HeroConverter, LanderHeroTwoColumn):
// choose the fixture, then wait until the progress card shows the result.
async function runFileTool(page, plan) {
  const selector = '[data-testid="tool-file-input"]';
  await setup("file input", () => waitForHydration(page, selector));
  await page.locator(selector).setInputFiles(plan.fixtures[0]);
  let state;
  try {
    const handle = await page.waitForFunction(
      () => {
        const sweep = globalThis.__sweep;
        const card = globalThis.document.querySelector('[data-testid="video-progress"]');
        const message = card?.querySelector("span.text-muted-foreground")?.textContent ?? null;
        let ui = null;
        if (card?.querySelector("svg.text-green-500")) ui = "completed";
        else if (card?.querySelector("svg.text-red-500")) ui = "failed";
        const event = sweep.telemetry.find((entry) =>
          ["tool_run_succeeded", "tool_run_failed", "tool_run_handed_off"].includes(entry.event),
        );
        // The card is the visitor's view. Telemetry alone ends the wait only
        // if the card never catches up.
        if (event && !ui) sweep.terminalSeenAt ??= Date.now();
        if (!ui && !(event && Date.now() - sweep.terminalSeenAt > 2_000)) return null;
        return { ui, event: event?.event ?? null, errorCode: event?.errorCode ?? null, message };
      },
      null,
      { timeout: plan.timeoutMs, polling: 250 },
    );
    state = await handle.jsonValue();
  } catch (error) {
    if (!isTimeout(error)) throw error;
    const last = await page
      .locator('[data-testid="video-progress"] span.text-muted-foreground')
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => null);
    return {
      outcome: "timeout",
      message: `no result after ${plan.timeoutMs / 1000} s${last ? ` (last shown: ${last.trim()})` : ""}`,
    };
  }
  const failed = state.ui === "failed" || (!state.ui && state.event !== "tool_run_succeeded");
  if (failed) {
    const message =
      state.event === "tool_run_handed_off" ? `handed off: ${state.errorCode}` : state.message;
    return { outcome: "failed", message, errorCode: state.errorCode };
  }
  return { outcome: "completed", outputs: await readOutputs(page) };
}

// Table converters (TableConvertLanding): upload the fixture, let the page
// parse and serialize it, then press Download.
async function runTableTool(page, plan) {
  const selector = 'input[type="file"]';
  await setup("file input", () => waitForHydration(page, selector));
  await page.locator(selector).first().setInputFiles(plan.fixtures[0]);
  await setup("upload", () =>
    page.getByText(`Selected: ${path.basename(plan.fixtures[0])}`).waitFor({ timeout: plan.timeoutMs }),
  );
  // Done when the output shows the fixture's data, the input shows a parse
  // error, or the output format says it isn't wired (that notice is there
  // before the upload too, and holds whatever the input).
  let state;
  try {
    const handle = await page.waitForFunction(
      (markers) => {
        const doc = globalThis.document;
        const parseError = doc.querySelector("div.bg-red-50")?.textContent?.trim();
        const notice = [...doc.querySelectorAll("p")]
          .map((element) => element.textContent?.trim() ?? "")
          .find((text) => /not wired yet|Waiting for valid input/i.test(text));
        if (parseError || notice) return { problem: parseError || notice };
        const output = [...doc.querySelectorAll("textarea[readonly]")].map((area) => area.value).join("\n");
        return markers.every((marker) => output.includes(marker)) ? { problem: null } : null;
      },
      plan.markers,
      { timeout: plan.timeoutMs },
    );
    state = await handle.jsonValue();
  } catch (error) {
    if (!isTimeout(error)) throw error;
    return { outcome: "timeout", message: `the output didn't show the input's data after ${plan.timeoutMs / 1000} s` };
  }
  if (state.problem) return { outcome: "failed", message: state.problem };
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await setup("download", () => waitForOutputs(page, 1, 5_000));
  return { outcome: "completed", outputs: await readOutputs(page, { text: true }) };
}

// Text converters show their output in a textarea. html-to-markdown converts
// a built-in sample on load, so wait for the fixture's data, not just text.
async function runTextTool(page, plan, { input, convert, output, download }) {
  await setup("text input", () => waitForHydration(page, input));
  await page.locator(input).fill(readFileSync(plan.fixtures[0], "utf8"));
  if (convert) await page.locator(convert).click();
  try {
    await page.waitForFunction(
      ({ target, markers }) => {
        const value = globalThis.document.querySelector(target)?.value ?? "";
        return value.trim() !== "" && markers.every((marker) => value.includes(marker));
      },
      { target: output, markers: plan.markers },
      { timeout: plan.timeoutMs },
    );
  } catch (error) {
    if (!isTimeout(error)) throw error;
    const shown = await page
      .locator(".text-red-600, .text-red-700, .bg-red-50")
      .first()
      .textContent({ timeout: 500 })
      .catch(() => null);
    if (shown) return { outcome: "failed", message: shown };
    const value = await page.locator(output).inputValue().catch(() => "");
    return value.trim()
      ? { outcome: "failed", message: `the output never showed the input's data (${plan.markers.join(", ")})` }
      : { outcome: "timeout", message: `no output after ${plan.timeoutMs / 1000} s` };
  }
  await page.locator(download).first().click();
  await setup("download", () => waitForOutputs(page, 1, 5_000));
  return { outcome: "completed", outputs: await readOutputs(page, { text: true }) };
}

async function runCsvCombiner(page, plan) {
  const input = '[data-testid="csv-combiner-input"]';
  await setup("file input", () => waitForHydration(page, input));
  await page.locator(input).setInputFiles(plan.fixtures);
  await page.locator('[data-testid="csv-combiner-run"]').click();
  const download = page.locator('[data-testid="csv-combiner-download"]');
  const problem = page.locator("div.bg-red-50");
  try {
    await download.or(problem).first().waitFor({ timeout: plan.timeoutMs });
  } catch (error) {
    if (!isTimeout(error)) throw error;
    return { outcome: "timeout", message: `no combined file after ${plan.timeoutMs / 1000} s` };
  }
  if (await problem.isVisible()) return { outcome: "failed", message: await problem.first().textContent() };
  await download.click();
  await setup("download", () => waitForOutputs(page, 1, 5_000));
  return { outcome: "completed", outputs: await readOutputs(page, { text: true }) };
}

// Batch PNG compression saves one ZIP; the PNGs inside are what's checked.
async function runBatchCompress(page, plan) {
  const input = '[data-testid="batch-compress-input"]';
  await setup("file input", () => waitForHydration(page, input));
  await page.locator(input).setInputFiles(plan.fixtures);
  const download = page.locator('[data-testid="batch-compress-download"]');
  const alert = page.getByRole("alert");
  try {
    await download.or(alert).first().waitFor({ timeout: plan.timeoutMs });
  } catch (error) {
    if (!isTimeout(error)) throw error;
    return { outcome: "timeout", message: `no ZIP offered after ${plan.timeoutMs / 1000} s` };
  }
  if (await alert.isVisible()) return { outcome: "failed", message: await alert.first().textContent() };
  await download.click();
  await setup("download", () => waitForOutputs(page, 1, 10_000));
  const [zip] = await readOutputs(page, { base64: true });
  const { BlobReader, Uint8ArrayWriter, ZipReader } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(zip.base64, "base64")])));
  const entries = await reader.getEntries();
  const outputs = [];
  for (const entry of entries) {
    const bytes = await entry.getData(new Uint8ArrayWriter());
    outputs.push({ name: entry.filename, size: bytes.length, head: Array.from(bytes.subarray(0, 1024)) });
  }
  await reader.close();
  if (outputs.length !== plan.fixtures.length) {
    return { outcome: "failed", message: `the ZIP holds ${outputs.length} files for ${plan.fixtures.length} inputs` };
  }
  return { outcome: "completed", outputs };
}

const DRIVERS = {
  file: runFileTool,
  table: runTableTool,
  "html-to-markdown": (page, plan) =>
    runTextTool(page, plan, {
      input: '[data-testid="html-input"]',
      output: '[data-testid="markdown-output"]',
      download: 'button:has-text("Download .md")',
    }),
  "json-to-csv": (page, plan) =>
    runTextTool(page, plan, {
      input: '[data-testid="json-input"]',
      convert: '[data-testid="json-convert"]',
      output: '[data-testid="csv-output"]',
      download: '[data-testid="json-to-csv-download"]',
    }),
  "csv-combiner": runCsvCombiner,
  "batch-compress": runBatchCompress,
};

class BrowserLost extends Error {}

// Each Tool run is its own visitor to the server-action cooldown (one server
// action per minute per client and IP): an address from 198.18.0.0/15, the
// range reserved for benchmarking.
let visitors = 0;
function visitorAddress() {
  const n = visitors++;
  return `198.${18 + ((n >> 16) & 1)}.${(n >> 8) & 255}.${n & 255}`;
}


async function measure(plan) {
  const started = Date.now();
  const blocked = new Set();
  const browser = await getBrowser();
  const visitor = visitorAddress();
  const pageErrors = [];
  let crashed = false;
  let context;
  let page;
  try {
    context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let handled;
      if (url.pathname === "/vendor/ffmpeg-st/ffmpeg-core.wasm") {
        handled = route.fulfill({
          contentType: "application/wasm",
          headers: { "access-control-allow-origin": "*" },
          body: ffmpegWasm,
        });
      } else if (url.origin !== baseOrigin) {
        blocked.add(url.host);
        handled = route.abort();
      } else {
        handled = route.continue({
          headers: { ...request.headers(), [SMOKE_TEST_HEADER]: "1", "x-forwarded-for": visitor },
        });
      }
      // The page may close while a request is in flight.
      return handled.catch(() => {});
    });
    await context.addInitScript(installCapture);
    page = await context.newPage();
  } catch (error) {
    await context?.close().catch(() => {});
    if (!browser.isConnected()) throw new BrowserLost(error.message);
    throw error;
  }
  const ffmpegLog = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[FFmpeg] ")) ffmpegLog.push(text.slice(9));
  });
  page.on("crash", () => {
    crashed = true;
  });

  let observation;
  try {
    const response = await page.goto(`${args.baseUrl}${toolHref(plan)}`, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response || response.status() >= 400) {
      observation = { outcome: "error", message: `page returned HTTP ${response?.status() ?? "nothing"}` };
    } else {
      observation = await DRIVERS[plan.driver](page, plan);
      // A script error can leave the progress card at 0% until the timeout.
      if (observation.outcome === "timeout" && pageErrors[0]) {
        observation.message = `${observation.message} (page error: ${pageErrors[0]})`;
      }
    }
  } catch (error) {
    if (!browser.isConnected()) throw new BrowserLost(error.message);
    // A crashed tab is the Tool's failure: a visitor's tab would crash too.
    const message = crashed
      ? "the tab crashed"
      : error instanceof HarnessError
        ? error.message
        : `harness: ${error.message.split("\n")[0]}`;
    observation = { outcome: "error", message: pageErrors[0] ? `${message} (page error: ${pageErrors[0]})` : message };
  } finally {
    await context.close().catch(() => {});
  }

  const verdict = classifyRun(observation, plan);
  const outputs = observation.outputs ?? [];
  return toRow(plan, {
    ...verdict,
    detail: /FFmpeg failed/.test(verdict.error ?? "") ? ffmpegError(ffmpegLog) : undefined,
    durationMs: Date.now() - started,
    output: outputs.length
      ? {
          files: outputs.length,
          bytes: outputs.reduce((sum, item) => sum + item.size, 0),
          name: outputs[0].name,
          // A compressor may hand back the input when it can't make it smaller.
          ...(plan.compress ? { inputBytes: plan.fixtures.reduce((sum, file) => sum + statSync(file).size, 0) } : {}),
        }
      : undefined,
    blocked: verdict.status === "pass" ? [] : [...blocked].sort(),
  });
}

// A browser that disconnects takes every running Tool with it: that's the
// harness failing, not the Tools, so they run again on a new browser.
async function measureWithRetry(plan) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await measure(plan);
    } catch (error) {
      if (!(error instanceof BrowserLost)) throw error;
      if (attempt >= BROWSER_ATTEMPTS) {
        return toRow(plan, {
          status: "error",
          error: `harness: the browser disconnected ${attempt} times during this Tool`,
        });
      }
      console.log(`browser lost during ${plan.id}; running it again (attempt ${attempt + 1})`);
    }
  }
}

let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.log("\nInterrupted: finishing the Tools in progress, then saving. Press Ctrl-C again to quit now.");
});

console.log(
  `${tools.length} active Tools, ${plans.length} selected: ${runnable.length} runnable, ` +
    `${plans.length - runnable.length} not run (skipped or no fixture). Measuring ${toRun.length} ` +
    `at concurrency ${args.concurrency} against ${args.baseUrl}.`,
);
writeResults();

let next = 0;
let done = 0;
const tally = {};
async function worker() {
  while (!interrupted && next < toRun.length) {
    const plan = toRun[next++];
    const row = await measureWithRetry(plan);
    newRows.push(row);
    runEntry.measured += 1;
    done += 1;
    tally[row.status] = (tally[row.status] ?? 0) + 1;
    writeResults();
    const elapsed = Date.now() - startedAt.getTime();
    const eta = Math.round(((elapsed / done) * (toRun.length - done)) / 60_000);
    const detail = row.status === "pass" ? "" : `  ${row.error ?? ""}`;
    console.log(
      `[${done}/${toRun.length}] ${row.status.padEnd(12)} ${plan.id} (${(row.durationMs / 1000).toFixed(1)} s, ~${eta} min left)${detail}`,
    );
  }
}
await Promise.all(Array.from({ length: Math.min(args.concurrency, toRun.length) }, worker));
if (browserPromise) await (await browserPromise).close();
writeResults();

console.log(`\nDone in ${((Date.now() - startedAt.getTime()) / 60_000).toFixed(1)} min: ${JSON.stringify(tally)}`);
console.log(`Results: ${path.relative(process.cwd(), outPath)}`);

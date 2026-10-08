// Pure helpers for scripts/tool-sweep.mjs: which active Tools the sweep can
// run and how, how one run's observation becomes a status, and how results
// merge across runs. The command drives the browser and does the I/O.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { requiresVideoConversion } from "../../lib/capabilities.ts";
import { resolveCompressionTarget } from "../../lib/compression-utils.ts";
import { MAGICK_BROWSER_INPUTS } from "../../lib/convert/magickBrowser.ts";
import { checkOutputFormat } from "../../lib/convert/output-format.ts";

export const STATUSES = ["pass", "wrong_format", "error", "timeout", "no_fixture", "skipped"];
// Statuses that come from running the Tool. A resumed run skips Tools that
// already have one, unless --retry names it.
export const MEASURED_STATUSES = new Set(["pass", "wrong_format", "error", "timeout"]);

export const DEFAULTS = {
  out: "benchmarks/tool-sweep-results.json",
  concurrency: 4,
  timeoutMs: 60_000,
  // FFmpeg loads 32 MB of wasm per page and runs single-threaded.
  ffmpegTimeoutMs: 180_000,
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseArgs(argv) {
  const args = {
    baseUrl: "",
    out: DEFAULTS.out,
    concurrency: DEFAULTS.concurrency,
    timeoutMs: DEFAULTS.timeoutMs,
    ffmpegTimeoutMs: DEFAULTS.ffmpegTimeoutMs,
    only: null,
    limit: null,
    resume: false,
    retry: new Set(),
    headed: false,
    summary: false,
  };
  const value = (index, name) => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`${name} needs a value`);
    return next;
  };
  const positiveInteger = (raw, name) => {
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
    return number;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") args.baseUrl = value(index++, arg).replace(/\/+$/, "");
    else if (arg === "--out") args.out = value(index++, arg);
    else if (arg === "--concurrency") args.concurrency = positiveInteger(value(index++, arg), arg);
    else if (arg === "--timeout") args.timeoutMs = positiveInteger(value(index++, arg), arg);
    else if (arg === "--ffmpeg-timeout") args.ffmpegTimeoutMs = positiveInteger(value(index++, arg), arg);
    else if (arg === "--only") args.only = splitList(value(index++, arg));
    else if (arg === "--limit") args.limit = positiveInteger(value(index++, arg), arg);
    else if (arg === "--resume") args.resume = true;
    else if (arg === "--retry") args.retry = new Set(splitList(value(index++, arg)));
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--summary") args.summary = true;
    else if (arg !== "--") throw new Error(`Unknown argument: ${arg}`);
  }
  for (const status of args.retry) {
    if (!MEASURED_STATUSES.has(status)) {
      throw new Error(`--retry takes measured statuses (${[...MEASURED_STATUSES].join(", ")}), not ${status}`);
    }
  }
  if (args.retry.size && !args.resume) throw new Error("--retry only applies with --resume");
  if (args.summary) return args;
  if (!args.baseUrl) throw new Error("--base-url is required");
  // Every run sends telemetry to the target's D1; thousands of runs belong in
  // a local database, never in staging's or production's.
  if (!LOCAL_HOSTS.has(new URL(args.baseUrl).hostname)) {
    throw new Error(`--base-url must be a local Worker (localhost), not ${args.baseUrl}`);
  }
  return args;
}

function splitList(raw) {
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

// The route of a page.tsx directory under app/, without route groups.
function routeOf(appDir, dir) {
  const parts = path.relative(appDir, dir).split(path.sep).filter((part) => part && !/^\(.*\)$/.test(part));
  return `/${parts.join("/")}`;
}

// The component a page renders: its first import from @/components outside
// sections/ (FAQ, how-to and link-hub sections sit under every Tool).
export function pageComponent(source) {
  const imports = source.matchAll(/import\s+(?:\{[^}]*\}|\w+)\s+from\s+["']@\/components\/([^"']+)["']/g);
  for (const [, modulePath] of imports) {
    if (!modulePath.startsWith("sections/")) return path.posix.basename(modulePath);
  }
  return "inline";
}

// Route -> component for every static page under app/. A Tool route that
// isn't here is served by app/(convert)/[tool]/page.tsx.
export function scanPageHandlers(appDir) {
  const handlers = new Map();
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("[")) visit(full);
      } else if (entry.name === "page.tsx") {
        handlers.set(routeOf(appDir, dir), pageComponent(readFileSync(full, "utf8")));
      }
    }
  };
  visit(appDir);
  return handlers;
}

// What app/(convert)/[tool]/page.tsx renders for a Tool without its own page.
export function dynamicRouteHandler(tool) {
  if ((tool.operation === "convert" || tool.operation === "compress") && tool.from && tool.to) {
    return "ToolPageRenderer";
  }
  if (tool.operation === "download") return "DownloaderPageRenderer";
  if (["video-editor", "image-editor", "audio-editor"].includes(tool.operation)) return "ToolPlaceholder";
  if (tool.operation === "view" || tool.operation === "edit") return "PdfToolPage";
  return "not-found";
}

export function handlerFor(tool, handlers) {
  return handlers.get(tool.route.replace(/\/+$/, "") || "/") ?? dynamicRouteHandler(tool);
}

// How each page is driven. ToolPageRenderer is the generic converter and
// compressor (HeroConverter or LanderHeroTwoColumn).
const DRIVERS = {
  ToolPageRenderer: "file",
  TableConvertLanding: "table",
  HtmlToMarkdownConverter: "html-to-markdown",
  JsonToCsv: "json-to-csv",
  CsvCombiner: "csv-combiner",
  BatchHeroConverter: "batch-compress",
};

const DOWNLOADER = "downloader: needs a real third-party media URL";
export const SKIP_REASONS = {
  DownloaderPageRenderer: DOWNLOADER,
  DownloaderPageTemplate: DOWNLOADER,
  TranscribeTool:
    "transcription: downloads a speech model and runs for minutes per file; measure it in a separate run",
  ToolPlaceholder: "coming-soon placeholder: nothing to run",
  PdfToolPage: "PDF viewer or editor: interactive, converts nothing",
  CharacterCounter: "text statistics: saves no file",
};

const ENGINES = {
  TableConvertLanding: "table-convert",
  HtmlToMarkdownConverter: "html-to-markdown-wasm",
  JsonToCsv: "javascript",
  CsvCombiner: "javascript",
  BatchHeroConverter: "jsquash-worker",
};

const COMPRESSION_ENGINES = {
  "image-worker": "jsquash-worker",
  "image-server": "server-image-compress",
  pdf: "server-pdf-compress",
  audio: "ffmpeg-wasm",
  video: "ffmpeg-wasm",
};

// The engine the generic converter page uses for a Tool: the branch order of
// compressFile and convertUnchecked in lib/convert/workerClient.ts, and the
// server-only outputs of shouldUseServerConversion in lib/convert/video.ts.
// Those try /api/video-convert first and fall back to FFmpeg in the browser
// when it fails, as it does on Workers. A label for grouping results; it
// decides nothing.
export function converterEngine({ operation, from, to }) {
  const source = from.toLowerCase();
  const target = to.toLowerCase();
  if (operation === "compress" && source === target) {
    return COMPRESSION_ENGINES[resolveCompressionTarget(source)] ?? "unsupported";
  }
  if (source === "ai" || source === "pdf") return "pdfjs";
  if (MAGICK_BROWSER_INPUTS.has(source)) return "imagemagick-wasm";
  if (source === "heic" || source === "heif") return "heif-decoder";
  if (requiresVideoConversion(source, target)) {
    const serverOnly =
      ["mxf", "rm", "rmvb"].includes(target) || (source === "amr" && ["mp2", "oga", "ogg"].includes(target));
    return serverOnly ? "server-video, then ffmpeg-wasm" : "ffmpeg-wasm";
  }
  return "browser-raster";
}

export function engineFor(tool, handler) {
  if (handler === "ToolPageRenderer") return converterEngine(tool);
  return ENGINES[handler] ?? null;
}

// Strings from the text fixtures that a converted copy must still contain,
// so a text output (no byte signature) proves it holds the input's data.
const TEXT_MARKERS = {
  "sample.csv": "Alpha",
  "sample-2.csv": "Gamma",
  "sample.json": "Alpha",
  "sample.html": "Nova",
};
const TEXT_DRIVERS = new Set(["table", "html-to-markdown", "json-to-csv", "csv-combiner"]);

// fixture-matrix.json: ready inputs by format, and per-Tool fixtures.
export function loadFixtures(benchmarksDir) {
  const matrix = JSON.parse(readFileSync(path.join(benchmarksDir, "fixture-matrix.json"), "utf8"));
  const resolve = (relative) => path.join(benchmarksDir, relative);
  const byFormat = new Map();
  for (const entry of matrix.formats ?? []) {
    if (entry.status === "ready" && entry.fixture) byFormat.set(entry.format, resolve(entry.fixture));
  }
  const byTool = new Map();
  for (const [toolId, entry] of Object.entries(matrix.toolFixtures ?? {})) {
    const files = entry.fixtures ?? (entry.fixture ? [entry.fixture] : []);
    if (files.length) byTool.set(toolId, files.map(resolve));
  }
  return { byFormat, byTool };
}

// Everything the sweep needs to know about one Tool before opening it. A plan
// with a status needs no browser.
export function planTool(tool, { handlers, fixtures, timeoutMs, ffmpegTimeoutMs }) {
  const handler = handlerFor(tool, handlers);
  const engine = engineFor(tool, handler);
  const base = { id: tool.id, route: tool.route, from: tool.from, to: tool.to, handler, engine };
  const driver = DRIVERS[handler];
  if (!driver) {
    return { ...base, status: "skipped", reason: SKIP_REASONS[handler] ?? `no sweep driver for ${handler}` };
  }
  const files =
    fixtures.byTool.get(tool.id) ?? (fixtures.byFormat.has(tool.from) ? [fixtures.byFormat.get(tool.from)] : null);
  if (!files) {
    return { ...base, status: "no_fixture", reason: `no ready ${tool.from} fixture in fixture-matrix.json` };
  }
  // A text output has no byte signature: without the fixture's data to look
  // for, a pass would prove nothing.
  const markers = TEXT_DRIVERS.has(driver) ? files.map((file) => TEXT_MARKERS[path.basename(file)]) : [];
  if (markers.some((marker) => !marker)) {
    return { ...base, status: "no_fixture", reason: `no data marker for the ${tool.from} fixture in TEXT_MARKERS` };
  }
  const slow = engine.includes("ffmpeg-wasm");
  return {
    ...base,
    driver,
    fixtures: files,
    markers,
    compress: tool.operation === "compress" || tool.operation === "bulk",
    timeoutMs: slow ? ffmpegTimeoutMs : timeoutMs,
  };
}

// checkOutputFormat passes any bytes for a format it has no signature for;
// zero bytes match none of the signatures it has.
export function hasSignature(format) {
  return !checkOutputFormat(new ArrayBuffer(16), format).ok;
}

const WRONG_FORMAT_MESSAGE = /produced \S+ instead of \S+/i;

function toArrayBuffer(head) {
  const bytes = Uint8Array.from(head ?? []);
  return bytes.buffer;
}

function formatName(format) {
  return format === "unknown" ? "unrecognised bytes" : format.toUpperCase();
}

// One run's observation -> { status, error, formatCheck }.
//   outcome: completed | failed | timeout | error
//   message: what the page showed (or the harness error)
//   errorCode: the tool_run_failed telemetry code, when one was sent
//   outputs: [{ name, size, head: number[] (first bytes), text? }]
export function classifyRun(observation, { to, markers = [] }) {
  const message = observation.message?.trim() || null;
  if (observation.outcome === "timeout") {
    return { status: "timeout", error: message ?? "no result before the timeout" };
  }
  if (observation.outcome === "failed") {
    if (observation.errorCode === "wrong_output_format" || WRONG_FORMAT_MESSAGE.test(message ?? "")) {
      return { status: "wrong_format", error: message ?? "wrong output format", formatCheck: "page" };
    }
    return { status: "error", error: message ?? observation.errorCode ?? "the Tool reported a failure" };
  }
  if (observation.outcome !== "completed") {
    return { status: "error", error: message ?? `harness: unexpected outcome ${observation.outcome}` };
  }

  const outputs = observation.outputs ?? [];
  if (!outputs.length) return { status: "error", error: "finished without saving a file" };
  const empty = outputs.find((output) => !output.size);
  if (empty) return { status: "error", error: `saved an empty file (${empty.name})` };
  for (const output of outputs) {
    const check = checkOutputFormat(toArrayBuffer(output.head), to);
    if (!check.ok) {
      return {
        status: "wrong_format",
        error: `saved ${formatName(check.detected)} instead of ${formatName(check.expected)} (${output.name})`,
        formatCheck: "signature",
      };
    }
  }
  const formatCheck = hasSignature(to) ? "signature" : markers.length ? "content" : "none";
  const missing = markers.filter((marker) => !outputs.some((output) => output.text?.includes(marker)));
  if (missing.length) {
    return {
      status: "error",
      error: `the saved file doesn't contain the input's data (missing ${missing.join(", ")})`,
      formatCheck,
    };
  }
  return { status: "pass", error: null, formatCheck };
}

// A text driver that waited for the fixture's data and gave up: an output
// that holds something else is the Tool's failure; no output is a timeout.
export function textOutputTimeout(output, { markers, timeoutMs }) {
  return output.trim()
    ? { outcome: "failed", message: `the output never showed the input's data (${markers.join(", ")})` }
    : { outcome: "timeout", message: `no output after ${timeoutMs / 1000} s` };
}

// The error a run records when its driver threw. "harness:" marks the
// harness's own failure, which --resume runs again. A crashed tab, or a page
// that never hydrated after a script error, is the Tool's failure: a
// visitor's page would be stuck too.
export function thrownError({ message, step = null, hydration = false, crashed = false, pageError = null }) {
  let error;
  if (crashed) error = "the tab crashed";
  else if (hydration && pageError) error = `the ${step} never became interactive`;
  else error = `harness: ${step ? `${step}: ` : ""}${message.split("\n")[0]}`;
  return pageError ? `${error} (page error: ${pageError})` : error;
}

// Whether the working tree differs from HEAD anywhere but the results file
// (or its temporary copy). Takes `git status --porcelain -z` output, whose
// paths are relative to the repository root, and the results file's path.
export function treeIsDirty(porcelain, resultsPath) {
  const own = new Set([resultsPath, `${resultsPath}.tmp`]);
  const entries = porcelain.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const status = entries[index].slice(0, 2);
    const paths = [entries[index].slice(3)];
    // A rename or copy is followed by the path it came from.
    if (/[RC]/.test(status)) paths.push(entries[(index += 1)]);
    if (paths.some((file) => !own.has(file))) return true;
  }
  return false;
}

// The line in FFmpeg's log that says why it stopped; the page only shows the
// exit code. The first message after "Stream mapping:" names the encoder or
// muxer that refused; without a mapping, the last message before the end says
// what was wrong with the input or the output file. Stream, metadata and
// progress lines describe the files and say nothing about the failure.
const FFMPEG_CONTEXT =
  /^(Stream #|Input #|Output #|Duration:|Metadata:|Side data:|Chapters?:|Press \[q\]|frame=|size=|cpb:|\w+\s+:\s)/;
export function ffmpegError(log) {
  const lines = log.map((line) => line.trim()).filter(Boolean);
  let end = lines.indexOf("Conversion failed!");
  if (end === -1) end = lines.indexOf("Aborted()");
  if (end === -1) end = lines.length;
  const mapping = lines.lastIndexOf("Stream mapping:", end);
  const messages = (from) => lines.slice(from, end).filter((line) => !FFMPEG_CONTEXT.test(line));
  const reason = mapping === -1 ? messages(0).at(-1) : messages(mapping + 1)[0];
  return reason?.replace(/ @ 0x[0-9a-f]+\]/i, "]");
}

// The runnable plans this run measures: all of them, or with --resume only
// those without a measured row, rows whose status --retry names, and rows
// where the harness, not the Tool, failed.
export function selectRuns(plans, previousRows, { resume, retry = new Set(), limit = null }) {
  const previous = new Map(previousRows.map((row) => [row.id, row]));
  const selected = plans.filter((plan) => {
    if (!resume) return true;
    const row = previous.get(plan.id);
    return (
      !row ||
      !MEASURED_STATUSES.has(row.status) ||
      retry.has(row.status) ||
      Boolean(row.error?.startsWith("harness:"))
    );
  });
  return limit ? selected.slice(0, limit) : selected;
}

// One results row: what the plan says about the Tool, what the run observed,
// and the commit and tree state (dirty: uncommitted changes outside the
// results file; null outside a git checkout) it was measured at.
export function sweepRow(plan, result, { commit, dirty }) {
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
    commit,
    dirty,
  };
}

// Rows from this run replace earlier rows for the same Tool; rows for Tools
// this run didn't touch are kept. Order follows the registry; rows for Tools
// that are no longer active are dropped.
export function mergeRows(activeIds, previousRows, newRows) {
  const byId = new Map(previousRows.map((row) => [row.id, row]));
  for (const row of newRows) byId.set(row.id, row);
  return activeIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
}

// One row per line, so a re-run diffs per Tool.
export function serializeResults({ meta, results }) {
  const metaJson = JSON.stringify(meta, null, 2).replace(/\n/g, "\n  ");
  const rows = results.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  return `{\n  "meta": ${metaJson},\n  "results": [\n${rows}\n  ]\n}\n`;
}

export function countStatuses(rows) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

const FAILING = ["wrong_format", "error", "timeout"];

function countBy(rows, key) {
  const table = new Map();
  for (const row of rows) {
    const name = key(row) ?? "(none)";
    const counts = table.get(name) ?? Object.fromEntries(FAILING.map((status) => [status, 0]));
    counts[row.status] += 1;
    table.set(name, counts);
  }
  return [...table.entries()].sort(
    ([nameA, a], [nameB, b]) => total(b) - total(a) || nameA.localeCompare(nameB),
  );
}

function total(counts) {
  return FAILING.reduce((sum, status) => sum + counts[status], 0);
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function table(header, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ].join("\n");
}

function failureText(row) {
  const error = (row.error ?? "").replace(/\s+/g, " ");
  return `${row.status}: ${error}${row.detail ? ` [${row.detail.replace(/\s+/g, " ")}]` : ""}`;
}

function idList(title, rows) {
  if (!rows.length) return null;
  const items = rows.map((row) => `- \`${row.id}\`: ${failureText(row).replace(/^\S+: /, "")}`);
  return `<details><summary>${title} (${rows.length})</summary>\n\n${items.join("\n")}\n\n</details>`;
}

// The Markdown summary for a PR or an issue comment.
export function renderSummary({ meta, results }, { activeCount = results.length } = {}) {
  const counts = countStatuses(results);
  const passes = results.filter((row) => row.status === "pass");
  const checks = { signature: 0, content: 0, none: 0 };
  for (const row of passes) checks[row.formatCheck] = (checks[row.formatCheck] ?? 0) + 1;
  const failing = results.filter((row) => FAILING.includes(row.status));
  const lines = [];

  const run = meta.runs?.at(-1);
  const wallMs = (meta.runs ?? []).reduce((sum, entry) => sum + (entry.wallMs ?? 0), 0);
  lines.push(
    `Measured commit \`${String(meta.commit).slice(0, 7)}\` on a local \`wrangler dev\` Worker` +
      (run ? `, concurrency ${run.concurrency}, ${formatDuration(wallMs)} in ${meta.runs.length} session(s).` : "."),
  );
  lines.push("");
  lines.push(
    table(
      ["Status", "Tools"],
      [
        [
          "pass",
          `${counts.pass} (file signature checked: ${checks.signature}, text content checked: ${checks.content}, no check for the output format: ${checks.none})`,
        ],
        ...STATUSES.slice(1).map((status) => [status, String(counts[status])]),
        ["**run / active**", `${results.filter((row) => MEASURED_STATUSES.has(row.status)).length} / ${activeCount}`],
      ],
    ),
  );

  if (failing.length) {
    // Long tables are collapsed so the counts above stay readable in a PR.
    const failingTable = (title, key) => {
      const rows = countBy(failing, key).map(([name, row]) => [name, ...FAILING.map((status) => String(row[status]))]);
      const body = table(["", ...FAILING], rows);
      return rows.length > 15
        ? `<details><summary>${title} (${rows.length})</summary>\n\n${body}\n\n</details>`
        : `${title}\n\n${body}`;
    };
    lines.push("", failingTable("Non-passing Tools by engine", (row) => row.engine));
    lines.push("", failingTable("Non-passing Tools by input format", (row) => row.from));

    // Clustered without the saved file's name, which differs per Tool.
    const messages = new Map();
    for (const row of failing) {
      const message = failureText(row).replace(/ \([^()]+\.[a-z0-9]+\)$/i, "");
      messages.set(message, (messages.get(message) ?? 0) + 1);
    }
    const top = [...messages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    lines.push(
      "",
      "Most common failures (FFmpeg's own reason in brackets):",
      "",
      table(["Failure", "Tools"], top.map(([text, n]) => [text.replace(/\|/g, "\\|"), String(n)])),
    );
  }

  const reasons = new Map();
  const missingFixtures = new Map();
  for (const row of results) {
    if (row.status === "skipped") reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
    if (row.status === "no_fixture") missingFixtures.set(row.from, (missingFixtures.get(row.from) ?? 0) + 1);
  }
  if (missingFixtures.size) {
    const formats = [...missingFixtures.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    reasons.set(
      `no fixture for the input format: ${formats.map(([format, n]) => `${format} ${n}`).join(", ")}`,
      counts.no_fixture,
    );
  }
  if (reasons.size) {
    const rows = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => [reason, String(n)]);
    lines.push("", "Not run:", "", table(["Reason", "Tools"], rows));
  }

  for (const status of FAILING) {
    const list = idList(`${status} Tool ids`, results.filter((row) => row.status === status));
    if (list) lines.push("", list);
  }
  return `${lines.join("\n")}\n`;
}

// Pure helpers for scripts/tool-status.mjs: join catalog intent, sweep
// verification, processing location and keyword demand by registry Tool id
// into one row per Tool, plus one row per keyword without a Tool of its own.
// The view owns no fact; each column comes from the source named here.

import { readFileSync } from "node:fs";
import path from "node:path";

import { toCsv } from "./csv.mjs";
import { parseKeywordsCsv } from "./keywords.mjs";

// Paths from apps/tools.
export const STATUS_INPUTS = {
  catalog: "lib/catalog/tools.json",
  sweep: "benchmarks/tool-sweep-results.json",
  keywords: "data/keywords.csv",
};
export const STATUS_OUTPUTS = {
  view: "benchmarks/tool-status.csv",
  summary: "benchmarks/tool-status-summary.md",
};

export const STATUS_COLUMNS = [
  // Catalog intent (tools.json); "not built" for a keyword row.
  "tool_id",
  "catalog_state",
  "operation",
  "from",
  "to",
  // Processing location, derived from the sweep's engine and handler.
  "processing_location",
  "engine",
  // Verification evidence (tool-sweep-results.json).
  "sweep_status",
  "sweep_note",
  "sweep_commit",
  // Keyword demand (keywords.csv).
  "keyword",
  "keyword_match",
  "alias_tool_id",
  "same_format",
  "global_volume",
  "us_volume",
  "kd",
  "global_traffic_potential",
  "us_traffic_potential",
  "keyword_source",
];

// Words that name the same format in a keyword and a Tool id.
export const FORMAT_ALIASES = [
  ["jpeg", "jpg"],
  ["word", "docx"],
  ["text", "txt"],
  ["tif", "tiff"],
  ["excel", "xlsx"],
  ["powerpoint", "pptx"],
  ["htm", "html"],
  ["mpeg", "mpg"],
];
const ALIAS_OF = new Map(FORMAT_ALIASES.flatMap(([a, b]) => [[a, b], [b, a]]));

// Engines the sweep records that run entirely in the browser.
const CLIENT_ENGINES = new Set([
  "ffmpeg-wasm",
  "imagemagick-wasm",
  "browser-raster",
  "pdfjs",
  "heif-decoder",
  "table-convert",
  "jsquash-worker",
  "javascript",
  "html-to-markdown-wasm",
]);
const DOWNLOADER_HANDLERS = new Set(["DownloaderPageRenderer", "DownloaderPageTemplate"]);

export const LOCATIONS = [
  "client-only",
  "server-executed",
  "server-first-client-fallback",
  "server-assisted-or-extension",
  "unknown",
];

// The Tool id a keyword joins: its words joined by hyphens.
export function keywordId(keyword) {
  return keyword.split(" ").join("-");
}

// The keyword's id with one or more format words swapped for their alias,
// such as docx-to-jpeg for "word to jpg". Excludes the keyword's own id.
export function aliasIds(keyword) {
  const words = keyword.split(" ");
  let variants = [[]];
  for (const word of words) {
    const options = ALIAS_OF.has(word) ? [word, ALIAS_OF.get(word)] : [word];
    variants = variants.flatMap((prefix) => options.map((option) => [...prefix, option]));
  }
  const own = keywordId(keyword);
  return variants
    .map((parts) => parts.join("-"))
    .filter((id) => id !== own)
    .sort();
}

const canonicalFormat = (format) => [format, ALIAS_OF.get(format) ?? format].sort()[0];

// "pdf to pdf" or "jpeg to jpg": a conversion keyword whose two sides are
// the same format, which usually means compression or editing intent.
export function isSameFormat(from, to) {
  return Boolean(from && to) && canonicalFormat(from) === canonicalFormat(to);
}

// How a keyword is covered: by the Tool with its id (live or retired), else
// by live Tools with an alias id, else not at all.
export function joinKeyword(keyword, toolsById) {
  const id = keywordId(keyword);
  if (toolsById.has(id)) return { match: "exact", toolId: id };
  const aliases = aliasIds(keyword).filter((alias) => toolsById.get(alias)?.isActive);
  if (aliases.length) return { match: "alias", toolId: aliases.join(" ") };
  return { match: "none", toolId: "" };
}

// Where a Tool's core operation runs, from its sweep row. The sweep labels
// the engine the page uses ("server-video, then ffmpeg-wasm" tries the server
// first); downloaders have no engine but are recognized by their page.
export function processingLocation(sweepRow) {
  if (!sweepRow) return "unknown";
  const { engine, handler } = sweepRow;
  if (DOWNLOADER_HANDLERS.has(handler)) return "server-assisted-or-extension";
  if (!engine) return "unknown";
  const [first, fallback] = engine.split(/,\s*then\s+/);
  if (first.startsWith("server-")) {
    if (!fallback) return "server-executed";
    return CLIENT_ENGINES.has(fallback) ? "server-first-client-fallback" : "unknown";
  }
  return CLIENT_ENGINES.has(engine) ? "client-only" : "unknown";
}

const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

// The error and FFmpeg's reason for a failure, why a Tool wasn't run, or how
// a pass was checked.
export function sweepNote(sweepRow) {
  if (!sweepRow) return "";
  if (sweepRow.status === "pass") return sweepRow.formatCheck ? `format check: ${sweepRow.formatCheck}` : "";
  if (sweepRow.error) return oneLine(`${sweepRow.error}${sweepRow.detail ? ` [${sweepRow.detail}]` : ""}`);
  return oneLine(sweepRow.reason);
}

// The commit the sweep measured this row at, shortened to 12 characters;
// "-dirty" marks a run with uncommitted changes. Each row records its own, so
// a targeted run changes only the rows it measured.
export function sweepCommit(sweepRow) {
  if (!sweepRow?.commit) return "unknown";
  return `${sweepRow.commit.slice(0, 12)}${sweepRow.dirty ? "-dirty" : ""}`;
}

function keywordColumns(keywordRow, match) {
  return {
    keyword: keywordRow.keyword,
    keyword_match: match.match,
    alias_tool_id: match.match === "alias" ? match.toolId : "",
    same_format: isSameFormat(keywordRow.from, keywordRow.to) ? "yes" : "",
    global_volume: keywordRow.global_volume,
    us_volume: keywordRow.us_volume,
    kd: keywordRow.kd,
    global_traffic_potential: keywordRow.global_traffic_potential,
    us_traffic_potential: keywordRow.us_traffic_potential,
    keyword_source: keywordRow.source,
  };
}

const sortKey = (row) => row.tool_id || keywordId(row.keyword);

// One row per catalog Tool, carrying the keyword whose id is the Tool's id,
// and one "not built" row per other keyword, sorted by Tool id (or the id
// the keyword would have). Throws if a Tool or a keyword would appear twice.
export function buildStatusRows({ tools, sweep, keywords }) {
  const toolsById = new Map();
  for (const tool of tools) {
    if (toolsById.has(tool.id)) throw new Error(`Duplicate Tool id in the catalog: ${tool.id}`);
    toolsById.set(tool.id, tool);
  }
  const sweepById = new Map((sweep?.results ?? []).map((row) => [row.id, row]));
  const keywordByTool = new Map();
  const rows = [];

  for (const keywordRow of keywords) {
    const match = joinKeyword(keywordRow.keyword, toolsById);
    if (match.match === "exact") {
      keywordByTool.set(match.toolId, keywordColumns(keywordRow, match));
      continue;
    }
    rows.push({
      catalog_state: "not built",
      operation: keywordRow.operation,
      from: keywordRow.from,
      to: keywordRow.to,
      ...keywordColumns(keywordRow, match),
    });
  }

  for (const tool of tools) {
    const sweepRow = sweepById.get(tool.id);
    rows.push({
      tool_id: tool.id,
      catalog_state: tool.isActive ? "live" : "retired",
      operation: tool.operation,
      from: tool.from,
      to: tool.to,
      processing_location: processingLocation(sweepRow),
      engine: sweepRow?.engine ?? "",
      sweep_status: sweepRow ? sweepRow.status : "not swept",
      sweep_note: sweepRow
        ? sweepNote(sweepRow)
        : tool.isActive
          ? "no row in tool-sweep-results.json"
          : "the sweep runs live Tools only",
      sweep_commit: sweepRow ? sweepCommit(sweepRow) : "",
      ...keywordByTool.get(tool.id),
    });
  }

  rows.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  assertEachOnce(rows, tools, keywords);
  return rows;
}

function assertEachOnce(rows, tools, keywords) {
  const count = (values) => values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map());
  const toolCounts = count(rows.filter((row) => row.tool_id).map((row) => row.tool_id));
  const keywordCounts = count(rows.filter((row) => row.keyword).map((row) => row.keyword));
  for (const tool of tools) {
    if (toolCounts.get(tool.id) !== 1) throw new Error(`Tool ${tool.id} appears ${toolCounts.get(tool.id) ?? 0} times`);
  }
  for (const { keyword } of keywords) {
    if (keywordCounts.get(keyword) !== 1) {
      throw new Error(`Keyword "${keyword}" appears ${keywordCounts.get(keyword) ?? 0} times`);
    }
  }
  const keys = rows.map(sortKey);
  if (new Set(keys).size !== keys.length) throw new Error("Two rows share a Tool id or keyword id");
}

export function renderStatusCsv(rows) {
  return toCsv(STATUS_COLUMNS, rows);
}

const formatCount = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function table(header, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map((_, index) => (index ? "---:" : "---")).join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ].join("\n");
}

function tally(rows, key, order) {
  const counts = new Map(order.map((name) => [name, 0]));
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 0);
}

const KEYWORD_COVERAGE = [
  ["Exact page, live", (row) => row.keyword_match === "exact" && row.catalog_state === "live"],
  ["Exact page, retired", (row) => row.keyword_match === "exact" && row.catalog_state === "retired"],
  ["Alias page only", (row) => row.keyword_match === "alias"],
  ["No page", (row) => row.keyword_match === "none"],
];

// The Markdown counts beside the view.
export function renderStatusSummary(rows, { sweep, keywords }) {
  const toolRows = rows.filter((row) => row.tool_id);
  const live = toolRows.filter((row) => row.catalog_state === "live");
  const keywordRows = rows.filter((row) => row.keyword);
  const commits = tally(
    toolRows.filter((row) => row.sweep_commit),
    (row) => row.sweep_commit,
    [],
  ).map(([commit, n]) => `\`${commit}\` (${formatCount(n)})`);
  const lastRun = sweep?.meta?.runs?.at(-1)?.finishedAt?.slice(0, 10) ?? "unknown";
  const sources = [...new Set(keywords.map((row) => row.source))];
  const volume = (subset) => formatCount(subset.reduce((sum, row) => sum + (row.global_volume ?? 0), 0));

  return [
    "# Tool status summary",
    "",
    "Generated by `pnpm -C apps/tools tool-status` with `tool-status.csv`; don't edit either by hand.",
    `Sweep rows by commit: ${commits.join(", ")}; last run ${lastRun}. Keywords: ${sources.join(", ")}.`,
    "",
    table(
      ["Catalog state", "Tools"],
      [...tally(toolRows, (row) => row.catalog_state, ["live", "retired"]), ["total", toolRows.length]].map(
        ([name, n]) => [name, formatCount(n)],
      ),
    ),
    "",
    table(
      ["Processing location (live Tools)", "Tools"],
      tally(live, (row) => row.processing_location, LOCATIONS).map(([name, n]) => [name, formatCount(n)]),
    ),
    "",
    table(
      ["Sweep status (live Tools)", "Tools"],
      tally(live, (row) => row.sweep_status, ["pass", "wrong_format", "error", "timeout", "no_fixture", "skipped"]).map(
        ([name, n]) => [name, formatCount(n)],
      ),
    ),
    "",
    table(
      ["Keyword coverage", "Keywords", "Global searches/mo"],
      [
        ...KEYWORD_COVERAGE.map(([name, test]) => {
          const subset = keywordRows.filter(test);
          return [name, formatCount(subset.length), volume(subset)];
        }),
        ["total", formatCount(keywordRows.length), volume(keywordRows)],
      ],
    ),
    "",
    `Same-format keywords (such as "pdf to pdf"): ${keywordRows.filter((row) => row.same_format).length}.`,
    `Rows: ${formatCount(rows.length)}, one per Tool and one per keyword without a Tool of its own ` +
      `(${keywordRows.filter((row) => !row.tool_id).length}).`,
    "",
  ].join("\n");
}

// The view and its summary from the committed inputs under apps/tools.
export function generateToolStatus(appRoot) {
  const read = (relative) => readFileSync(path.join(appRoot, relative), "utf8");
  const tools = JSON.parse(read(STATUS_INPUTS.catalog));
  const sweep = JSON.parse(read(STATUS_INPUTS.sweep));
  const keywords = parseKeywordsCsv(read(STATUS_INPUTS.keywords));
  const rows = buildStatusRows({ tools, sweep, keywords });
  return { rows, csv: renderStatusCsv(rows), summary: renderStatusSummary(rows, { sweep, keywords }) };
}

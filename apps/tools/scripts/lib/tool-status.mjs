// Pure helpers for scripts/tool-status.mjs: join catalog intent, sweep
// verification, processing location and keyword demand by registry Tool id
// into one row per Tool, plus one row per keyword without a Tool of its own.
// The view owns no fact; each column comes from the source named here.

import { readFileSync } from "node:fs";
import path from "node:path";

import { toCsv } from "./csv.mjs";
import { parseKeywordsCsv } from "./keywords.mjs";
import { ENGINE_LOCATIONS, STATUSES } from "./tool-sweep.mjs";

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
  // Catalog intent (tools.json): live or retired; on a keyword row, alias
  // page or not built.
  "tool_id",
  "catalog_state",
  "operation",
  "from",
  "to",
  // Processing location, inferred from the sweep's engine label.
  "processing_location",
  "engine",
  // Verification evidence (tool-sweep-results.json).
  "sweep_status",
  "sweep_note",
  "sweep_commit",
  // Keyword demand (keywords.csv): the keyword whose id is this row's.
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
  // On a live Tool row: the keywords it serves as their alias page.
  "alias_keywords",
  "alias_global_volume",
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

// "pdf to pdf": a conversion keyword with the same format word on both
// sides, which usually means compression or editing intent. Aliases don't
// count: "jpeg to jpg" is a real conversion search with its own page.
export function isSameFormat(from, to) {
  return Boolean(from) && from === to;
}

// How a keyword is covered: by the Tool with its id (live or retired), else
// by live Tools with an alias id, else not at all. A retired exact Tool also
// names any live alias Tool, which is the page visitors can still reach.
export function joinKeyword(keyword, toolsById) {
  const id = keywordId(keyword);
  const liveAliases = aliasIds(keyword).filter((alias) => toolsById.get(alias)?.isActive);
  const exact = toolsById.get(id);
  if (exact) return { match: "exact", toolId: id, aliasToolIds: exact.isActive ? [] : liveAliases };
  if (liveAliases.length) return { match: "alias", toolId: "", aliasToolIds: liveAliases };
  return { match: "none", toolId: "", aliasToolIds: [] };
}

// Where a Tool's core operation runs, inferred (not observed) from the
// engine label the sweep records, through ENGINE_LOCATIONS. A downloader has
// no engine: its page fetches through /api/media-fetch or hands off to the
// extension. "unknown" means the sweep recorded no engine or has no row.
export function processingLocation(tool, sweepRow) {
  if (tool.operation === "download") return "server-assisted-or-extension";
  const engine = sweepRow?.engine;
  if (engine == null) return "unknown";
  if (!Object.hasOwn(ENGINE_LOCATIONS, engine)) {
    throw new Error(
      `The sweep's engine "${engine}" (${tool.id}) has no processing location: ` +
        "add it to ENGINE_LOCATIONS in apps/tools/scripts/lib/tool-sweep.mjs",
    );
  }
  return ENGINE_LOCATIONS[engine];
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

function keywordColumns(keywordRow, join) {
  return {
    keyword: keywordRow.keyword,
    keyword_match: join.match,
    alias_tool_id: join.aliasToolIds.join(" "),
    same_format: isSameFormat(keywordRow.from, keywordRow.to) ? "yes" : "",
    global_volume: keywordRow.global_volume,
    us_volume: keywordRow.us_volume,
    kd: keywordRow.kd,
    global_traffic_potential: keywordRow.global_traffic_potential,
    us_traffic_potential: keywordRow.us_traffic_potential,
    keyword_source: keywordRow.source,
  };
}

// The keywords a Tool serves as their alias page, and their known global
// volume (blank when none of them has one).
function aliasDemandColumns(keywordRows = []) {
  if (!keywordRows.length) return {};
  const volumes = keywordRows.map((row) => row.global_volume).filter((volume) => volume != null);
  return {
    alias_keywords: keywordRows
      .map((row) => row.keyword)
      .sort()
      .join("; "),
    alias_global_volume: volumes.length ? volumes.reduce((sum, volume) => sum + volume, 0) : null,
  };
}

const sortKey = (row) => row.tool_id || keywordId(row.keyword);

// One row per catalog Tool, carrying the keyword whose id is the Tool's id,
// and one row per other keyword ("alias page" or "not built"), sorted by Tool
// id (or the id the keyword would have). Throws if a Tool or a keyword would
// appear other than once.
export function buildStatusRows({ tools, sweep, keywords }) {
  const toolsById = new Map();
  for (const tool of tools) {
    if (toolsById.has(tool.id)) throw new Error(`Duplicate Tool id in the catalog: ${tool.id}`);
    toolsById.set(tool.id, tool);
  }
  const sweepById = new Map((sweep?.results ?? []).map((row) => [row.id, row]));
  const keywordByTool = new Map();
  const aliasDemand = new Map();
  const rows = [];

  for (const keywordRow of keywords) {
    const join = joinKeyword(keywordRow.keyword, toolsById);
    for (const aliasId of join.aliasToolIds) {
      aliasDemand.set(aliasId, [...(aliasDemand.get(aliasId) ?? []), keywordRow]);
    }
    if (join.match === "exact") {
      keywordByTool.set(join.toolId, keywordColumns(keywordRow, join));
      continue;
    }
    rows.push({
      catalog_state: join.match === "alias" ? "alias page" : "not built",
      operation: keywordRow.operation,
      from: keywordRow.from,
      to: keywordRow.to,
      ...keywordColumns(keywordRow, join),
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
      processing_location: processingLocation(tool, sweepRow),
      engine: sweepRow?.engine ?? "",
      sweep_status: sweepRow ? sweepRow.status : "not swept",
      sweep_note: sweepRow
        ? sweepNote(sweepRow)
        : tool.isActive
          ? "no row in tool-sweep-results.json"
          : "the sweep runs live Tools only",
      sweep_commit: sweepRow ? sweepCommit(sweepRow) : "",
      ...keywordByTool.get(tool.id),
      ...aliasDemandColumns(aliasDemand.get(tool.id)),
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

const retiredExact = (row) => row.keyword_match === "exact" && row.catalog_state === "retired";
const KEYWORD_COVERAGE = [
  ["Exact page, live", (row) => row.keyword_match === "exact" && row.catalog_state === "live"],
  ["Exact page retired, live alias page", (row) => retiredExact(row) && Boolean(row.alias_tool_id)],
  ["Exact page retired, no live alias", (row) => retiredExact(row) && !row.alias_tool_id],
  ["Alias page only", (row) => row.keyword_match === "alias"],
  ["No page", (row) => row.keyword_match === "none"],
];

// The summary as written, before Prettier formats it.
export function renderStatusSummary(rows, { sweep }) {
  const toolRows = rows.filter((row) => row.tool_id);
  const live = toolRows.filter((row) => row.catalog_state === "live");
  const keywordRows = rows.filter((row) => row.keyword);
  const commits = tally(toolRows.filter((row) => row.sweep_commit), (row) => row.sweep_commit, []).map(
    ([commit, n]) => `\`${commit}\` (${formatCount(n)})`,
  );
  const lastRun = sweep?.meta?.runs?.at(-1)?.finishedAt?.slice(0, 10) ?? "unknown";
  const volume = (subset) => formatCount(subset.reduce((sum, row) => sum + (row.global_volume ?? 0), 0));
  const counted = (entries) => entries.map(([name, n]) => [name, formatCount(n)]);

  return [
    "# Tool status summary",
    "",
    "Generated by `pnpm -C apps/tools tool-status` with `tool-status.csv`; don't edit either by hand.",
    `Sweep rows by commit: ${commits.join(", ")}; last run ${lastRun}.`,
    "",
    table(
      ["Catalog state", "Tools"],
      counted([...tally(toolRows, (row) => row.catalog_state, ["live", "retired"]), ["total", toolRows.length]]),
    ),
    "",
    table(
      ["Processing location (live Tools)", "Tools"],
      counted(tally(live, (row) => row.processing_location, LOCATIONS)),
    ),
    "",
    table(["Sweep status (live Tools)", "Tools"], counted(tally(live, (row) => row.sweep_status, STATUSES))),
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
    table(["Keyword source", "Keywords"], counted(tally(keywordRows, (row) => row.keyword_source, []))),
    "",
    `Same-format keywords (such as "pdf to pdf"): ${keywordRows.filter((row) => row.same_format).length}.`,
    `Rows: ${formatCount(rows.length)}, one per Tool and one per keyword without a Tool of its own ` +
      `(${keywordRows.filter((row) => !row.tool_id).length}).`,
    "",
  ].join("\n");
}

// The view and its summary from the committed inputs under apps/tools. The
// summary goes through Prettier, so `pnpm format` leaves it unchanged.
export async function generateToolStatus(appRoot) {
  const read = (relative) => readFileSync(path.join(appRoot, relative), "utf8");
  const tools = JSON.parse(read(STATUS_INPUTS.catalog));
  const sweep = JSON.parse(read(STATUS_INPUTS.sweep));
  const keywords = parseKeywordsCsv(read(STATUS_INPUTS.keywords));
  const rows = buildStatusRows({ tools, sweep, keywords });
  const prettier = await import("prettier");
  const summaryPath = path.join(appRoot, STATUS_OUTPUTS.summary);
  const options = (await prettier.resolveConfig(summaryPath)) ?? {};
  const summary = await prettier.format(renderStatusSummary(rows, { sweep }), { ...options, filepath: summaryPath });
  return { rows, csv: renderStatusCsv(rows), summary };
}

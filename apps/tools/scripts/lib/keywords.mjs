// Pure helpers for scripts/keywords.mjs: turn keyword-research exports into
// data/keywords.csv, one row per cleaned keyword, sorted by keyword so a
// refreshed export diffs row by row.

import { readFileSync } from "node:fs";
import path from "node:path";

import { parseCsv, toCsv } from "./csv.mjs";

// Sources merged into data/keywords.csv, with paths from apps/tools. Exports
// are listed oldest first: a later export replaces an earlier export's row
// for the same keyword, so `source` always names the export every metric
// came from. A `candidates` source only adds keywords no export has, with
// blank metrics, and never replaces a row.
export const KEYWORD_SOURCES = [
  // 1,634 conversion keywords researched in January 2026 (US database).
  { source: "ahrefs-2026-01", file: "data/sources/ahrefs-2026-01-kwr-tools.csv" },
  // The removed tools-planner.csv's ideas that no catalog Tool covered and
  // no export had (issue #232): 70 compressor ideas.
  {
    source: "tools-planner.csv (removed 2026-10-09)",
    file: "data/sources/tools-planner-2026-10-09-candidates.csv",
    candidates: true,
  },
];

export const KEYWORD_COLUMNS = [
  "keyword",
  "from",
  "to",
  "operation",
  "global_volume",
  "us_volume",
  "kd",
  "global_traffic_potential",
  "us_traffic_potential",
  "source",
];

const METRICS = ["global_volume", "us_volume", "kd", "global_traffic_potential", "us_traffic_potential"];

// Export header (lowercased) -> keywords.csv column. The short names are the
// January 2026 research sheet; the long ones are what Ahrefs Keywords Explorer
// writes, where "Volume" and "Traffic potential" are for the export's country.
const HEADERS = {
  tool: "keyword",
  keyword: "keyword",
  operation: "operation",
  gsv: "global_volume",
  "global volume": "global_volume",
  sv: "us_volume",
  volume: "us_volume",
  kd: "kd",
  difficulty: "kd",
  "keyword difficulty": "kd",
  gtp: "global_traffic_potential",
  "global traffic potential": "global_traffic_potential",
  tp: "us_traffic_potential",
  "traffic potential": "us_traffic_potential",
  country: "country",
};

// An export row with keywords.csv column names; other columns are dropped.
function renameColumns(raw) {
  const row = {};
  for (const [header, value] of Object.entries(raw)) {
    const column = HEADERS[header.trim().toLowerCase()];
    if (column && !row[column]) row[column] = value;
  }
  return row;
}

const BLANK = new Set(["", "-", "n/a"]);

// Lowercase words separated by single spaces: punctuation and runs of
// whitespace become one space, so "HEIC  to .JPG" is "heic to jpg".
export function cleanKeyword(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// A plain integer from "226,000", "1500" or "12.0"; null when the export has
// no value. Anything else is an error rather than a guess.
export function parseCount(value, where = "value") {
  const text = String(value ?? "").trim();
  if (BLANK.has(text.toLowerCase())) return null;
  const plain = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(plain)) throw new Error(`${where}: not a count: ${JSON.stringify(text)}`);
  return Math.round(Number(plain));
}

// "heic to jpg" -> { from: "heic", to: "jpg" }; other keywords have neither.
export function splitConversion(keyword) {
  const match = /^(\S+) to (\S+)$/.exec(keyword);
  return match ? { from: match[1], to: match[2] } : { from: "", to: "" };
}

// Ahrefs can export UTF-16 with a byte-order mark; the sheet is UTF-8.
export function decodeExport(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  const text = buffer.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// One export's rows in keywords.csv shape. Within an export, a keyword that
// appears twice after cleaning keeps its higher-volume row.
export function parseExport(text, source) {
  const rows = parseCsv(text).map(renameColumns);
  if (rows.length && !("keyword" in rows[0])) throw new Error(`${source}: no Keyword column`);
  const byKeyword = new Map();
  rows.forEach((raw, index) => {
    const where = `${source} row ${index + 2}`;
    if (raw.country && raw.country.trim().toLowerCase() !== "us") {
      throw new Error(`${where}: volumes are for ${raw.country}, not the US`);
    }
    const keyword = cleanKeyword(raw.keyword);
    if (!keyword) return;
    const conversion = splitConversion(keyword);
    const row = {
      keyword,
      ...conversion,
      operation: cleanKeyword(raw.operation) || (conversion.from ? "convert" : ""),
      ...Object.fromEntries(METRICS.map((metric) => [metric, parseCount(raw[metric], `${where} ${metric}`)])),
      source,
    };
    const existing = byKeyword.get(keyword);
    if (!existing || (row.global_volume ?? -1) > (existing.global_volume ?? -1)) byKeyword.set(keyword, row);
  });
  return [...byKeyword.values()];
}

// Sources as { rows, candidates }, exports oldest first. A later export's row
// replaces an earlier one's; a candidate row is added only when no export has
// the keyword. Sorted by keyword.
export function mergeExports(sources) {
  const byKeyword = new Map();
  for (const { rows } of sources.filter((entry) => !entry.candidates)) {
    for (const row of rows) byKeyword.set(row.keyword, row);
  }
  for (const { rows } of sources.filter((entry) => entry.candidates)) {
    for (const row of rows) if (!byKeyword.has(row.keyword)) byKeyword.set(row.keyword, row);
  }
  return [...byKeyword.values()].sort((a, b) => (a.keyword < b.keyword ? -1 : 1));
}

// data/keywords.csv as KEYWORD_SOURCES builds it.
export function buildKeywordsCsv(appRoot, sources = KEYWORD_SOURCES) {
  const parsed = sources.map(({ source, file, candidates = false }) => ({
    rows: parseExport(decodeExport(readFileSync(path.join(appRoot, file))), source),
    candidates,
  }));
  return toCsv(KEYWORD_COLUMNS, mergeExports(parsed));
}

// data/keywords.csv back into rows, with counts as numbers or null.
export function parseKeywordsCsv(text) {
  return parseCsv(text).map((row) => ({
    ...row,
    ...Object.fromEntries(METRICS.map((metric) => [metric, parseCount(row[metric], `${row.keyword} ${metric}`)])),
  }));
}

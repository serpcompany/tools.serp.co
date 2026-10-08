// Builds data/keywords.csv (issue #232): the keywords we have search demand
// for, cleaned from the sources listed in KEYWORD_SOURCES
// (scripts/lib/keywords.mjs). Keywords are lowercased with punctuation and
// extra whitespace removed; counts are plain integers, blank when the export
// has none; rows are sorted by keyword so a refreshed export diffs per row.
//
//   pnpm -C apps/tools keywords
//
// Sources live in data/sources/, named by date: ahrefs-2026-01-kwr-tools.csv
// is the January 2026 Ahrefs export. To merge a later one, save the export
// (CSV, or Ahrefs' UTF-16 export of the US database, with Keyword, Volume,
// Global volume, KD, Traffic potential and Global traffic potential columns)
// as data/sources/ahrefs-<yyyy-mm>-<topic>.csv, add it after the other
// exports in KEYWORD_SOURCES with a source label such as "ahrefs-2026-11",
// and run this command. Its rows replace older rows for the same keyword.
// Then run `pnpm -C apps/tools tool-status` so the status view picks it up.
// lib/keywords.test.mjs fails when data/keywords.csv differs from a rebuild.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildKeywordsCsv } from "./lib/keywords.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(appRoot, "data/keywords.csv");

const csv = buildKeywordsCsv(appRoot);
writeFileSync(outPath, csv);
const rows = csv.trimEnd().split("\n").length - 1;
console.log(`Wrote ${rows} keywords to ${path.relative(process.cwd(), outPath)}`);

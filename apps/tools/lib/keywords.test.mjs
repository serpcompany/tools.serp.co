import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  KEYWORD_COLUMNS,
  buildKeywordsCsv,
  cleanKeyword,
  decodeExport,
  mergeExports,
  parseCount,
  parseExport,
  parseKeywordsCsv,
  splitConversion,
} from "../scripts/lib/keywords.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("keywords are lowercased with punctuation and extra whitespace removed", () => {
  assert.equal(cleanKeyword("  HEIC  to .JPG "), "heic to jpg");
  assert.equal(cleanKeyword("Word-to-PDF"), "word to pdf");
  assert.equal(cleanKeyword("mp4\tto mp3!"), "mp4 to mp3");
});

test("counts become plain integers, and a missing count stays blank", () => {
  assert.equal(parseCount("226,000"), 226000);
  assert.equal(parseCount("1500"), 1500);
  assert.equal(parseCount("12.0"), 12);
  assert.equal(parseCount(""), null);
  assert.equal(parseCount("-"), null);
  assert.throws(() => parseCount("lots"), /not a count/);
});

test("a conversion keyword names its two formats", () => {
  assert.deepEqual(splitConversion("heic to jpg"), { from: "heic", to: "jpg" });
  assert.deepEqual(splitConversion("convert heic to jpg"), { from: "", to: "" });
});

test("the research sheet's columns map to keywords.csv", () => {
  const sheet =
    "tool,kd,sv,gsv,tp,gtp,processed_in,operation,status,engine_group,\n" +
    'HEIC to JPG,28,"226,000",1070000,380000,964000,,convert,,image/heif,\n';
  assert.deepEqual(parseExport(sheet, "ahrefs-2026-01"), [
    {
      keyword: "heic to jpg",
      from: "heic",
      to: "jpg",
      operation: "convert",
      global_volume: 1070000,
      us_volume: 226000,
      kd: 28,
      global_traffic_potential: 964000,
      us_traffic_potential: 380000,
      source: "ahrefs-2026-01",
    },
  ]);
});

test("an Ahrefs UTF-16 export merges in, and its rows replace older ones", () => {
  const tsv =
    "#\tKeyword\tCountry\tDifficulty\tVolume\tGlobal volume\tTraffic potential\tGlobal traffic potential\n" +
    "1\tHEIC to JPG\tus\t30\t240000\t1100000\t390000\t990000\n2\tAVIF to PNG\tus\t5\t9000\t40000\t\t\n";
  const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tsv, "utf16le")]);
  const later = parseExport(decodeExport(buffer), "ahrefs-2026-11");
  const earlier = parseExport("tool,gsv\nheic to jpg,1070000\nwebp to png,1140000\n", "ahrefs-2026-01");
  const merged = mergeExports([{ rows: earlier }, { rows: later }]);

  assert.deepEqual(
    merged.map((row) => [row.keyword, row.global_volume, row.us_traffic_potential, row.source]),
    [
      ["avif to png", 40000, null, "ahrefs-2026-11"],
      ["heic to jpg", 1100000, 390000, "ahrefs-2026-11"],
      ["webp to png", 1140000, null, "ahrefs-2026-01"],
    ],
  );
  assert.throws(() => parseExport("Keyword\tCountry\tVolume\nheic to jpg\tgb\t10\n", "x"), /not the US/);
});

test("keywords sort by keyword, so a refreshed export diffs row by row", () => {
  const rows = parseExport("tool,gsv,sv\nc to d,10,\nb to c,,5\nd to e,,\na to b,,9\n", "x");
  assert.deepEqual(
    mergeExports([{ rows }]).map((row) => row.keyword),
    ["a to b", "b to c", "c to d", "d to e"],
  );
});

test("candidates add only keywords no export has, and never replace an export's row", () => {
  const ideas = parseExport("keyword,operation\nzip compressor,compress\nheic to jpg,convert\n", "planner");
  const early = parseExport("tool,gsv\nheic to jpg,1070000\n", "ahrefs-2026-01");
  const late = parseExport("Keyword,Global volume\nzip compressor,5000\n", "ahrefs-2026-11");
  const rows = (sources) => mergeExports(sources).map((row) => [row.keyword, row.global_volume, row.source]);

  assert.deepEqual(rows([{ rows: early }, { rows: ideas, candidates: true }]), [
    ["heic to jpg", 1070000, "ahrefs-2026-01"],
    ["zip compressor", null, "planner"],
  ]);
  // A later export with search data for an idea replaces it, wherever the candidates are listed.
  assert.deepEqual(rows([{ rows: early }, { rows: ideas, candidates: true }, { rows: late }]), [
    ["heic to jpg", 1070000, "ahrefs-2026-01"],
    ["zip compressor", 5000, "ahrefs-2026-11"],
  ]);
});

test("data/keywords.csv matches a fresh run of pnpm -C apps/tools keywords", () => {
  const committed = readFileSync(path.join(appRoot, "data/keywords.csv"), "utf8");
  assert.ok(
    committed === buildKeywordsCsv(appRoot),
    "data/keywords.csv is stale: run `pnpm -C apps/tools keywords` and commit the result",
  );
  const rows = parseKeywordsCsv(committed);
  assert.deepEqual(Object.keys(rows[0]), KEYWORD_COLUMNS);
  assert.equal(new Set(rows.map((row) => row.keyword)).size, rows.length);
});

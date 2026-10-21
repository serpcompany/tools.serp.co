import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { formatNamesSource } from "../scripts/format-names.mjs";

const formats = JSON.parse(readFileSync(new URL("./formats.json", import.meta.url), "utf8"));
const registry = JSON.parse(
  readFileSync(new URL("../lib/catalog/tools.json", import.meta.url), "utf8"),
);

const KINDS = new Set([
  "image", "raster-camera", "vector", "document", "ebook", "spreadsheet", "presentation",
  "audio", "video", "archive", "font", "3d", "text", "data", "other",
]);
const FACT_KEYS = ["name", "fullName", "kind", "summary", "usedFor", "properties", "openWith"];

const used = new Set();
for (const tool of registry) {
  if (!tool.isActive || !["convert", "compress"].includes(tool.operation)) continue;
  for (const format of [tool.from, tool.to]) if (format) used.add(format);
}

test("every format a live converter or compressor uses has an entry", () => {
  const missing = [...used].filter((format) => !(format in formats)).sort();
  assert.deepEqual(missing, []);
});

test("every entry is used by a live converter or compressor", () => {
  const unused = Object.keys(formats).filter((format) => !used.has(format)).sort();
  assert.deepEqual(unused, []);
});

test("aliases point at a fact entry", () => {
  for (const [key, entry] of Object.entries(formats)) {
    if (!("aliasOf" in entry)) continue;
    assert.deepEqual(Object.keys(entry), ["aliasOf"], key);
    assert.ok(formats[entry.aliasOf], `${key} points at missing ${entry.aliasOf}`);
    assert.ok(!("aliasOf" in formats[entry.aliasOf]), `${key} points at another alias`);
  }
});

test("every fact entry has the documented shape and limits", () => {
  for (const [key, entry] of Object.entries(formats)) {
    if ("aliasOf" in entry) continue;
    assert.deepEqual(Object.keys(entry), FACT_KEYS, key);
    for (const field of ["name", "fullName", "summary"]) {
      assert.equal(typeof entry[field], "string", `${key}.${field}`);
      assert.ok(entry[field].trim().length > 0, `${key}.${field}`);
    }
    assert.ok(KINDS.has(entry.kind), `${key} has unknown kind ${entry.kind}`);
    const words = entry.summary.trim().split(/\s+/).length;
    assert.ok(words <= 40, `${key}.summary has ${words} words`);
    for (const field of ["usedFor", "properties", "openWith"]) {
      const list = entry[field];
      assert.ok(Array.isArray(list), `${key}.${field}`);
      assert.ok(list.length >= 2 && list.length <= 5, `${key}.${field} has ${list.length} items`);
      for (const item of list) {
        assert.equal(typeof item, "string", `${key}.${field}`);
        assert.ok(item.trim().length > 0, `${key}.${field}`);
      }
      const seen = new Set();
      for (const item of list) {
        const normalized = item.trim().toLowerCase();
        assert.ok(!seen.has(normalized), `${key}.${field} repeats "${item}"`);
        seen.add(normalized);
      }
    }
  }
});

test("lib/format-names.ts is generated from the current formats.json", () => {
  const generated = readFileSync(new URL("../lib/format-names.ts", import.meta.url), "utf8");
  assert.equal(generated, formatNamesSource(formats), "run node apps/tools/scripts/format-names.mjs");
});

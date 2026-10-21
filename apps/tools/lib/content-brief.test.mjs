// `pnpm content:brief` (#356): a self-contained brief per batch, from the
// registry, the Tool status view, the engine facts and the style guide.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { briefProblems, buildBrief } from "../scripts/lib/content-brief.mjs";
import { splitRegistry } from "../scripts/lib/content.mjs";
import { parseCsv } from "../scripts/lib/csv.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");
const read = (file) => readFileSync(file, "utf8");
const tools = splitRegistry(read(path.join(appRoot, "lib/catalog/tools.json"))).map((entry) => JSON.parse(entry));
const statusRows = parseCsv(read(path.join(appRoot, "benchmarks/tool-status.csv")));
const examples = JSON.parse(read(path.join(appRoot, "content/batches/examples.json")));
const styleGuide = read(path.join(repoRoot, "docs/converter-copy.md"));
const readDoc = (doc) => read(path.join(repoRoot, doc));

const brief = (ids, formats = null) =>
  buildBrief({ name: "test", ids, tools, statusRows, formats, styleGuide, examples, readDoc });

const section = (text, id) => text.slice(text.indexOf(`## ${id}\n`)).split(/\n## (?!#)/)[0];

test("a brief gives each Tool its keyword, engine facts, current copy and an entry to fill", () => {
  const text = brief(["webp-to-png", "compress-m4a", "csv-to-json"]);
  assert.match(text, /^# Converter copy brief: test\n/);
  assert.match(text, /`apps\/tools\/content\/batches\/test\.json`/);
  assert.match(text, /## Style guide\n\nHow the copy on converter and compressor pages/);
  assert.match(text, /## Example: mp4-to-mp3\n/, "an FFmpeg Tool in the batch picks the FFmpeg example");

  const webp = section(text, "webp-to-png");
  assert.match(webp, /Keyword: \*\*webp to png\*\* \(exact match\), [\d,]+ searches a month worldwide/);
  assert.match(webp, /Engine: browser-raster; runs client-only\./);
  assert.match(webp, /An animated input gives its first frame only/);
  assert.match(webp, /Not settled by the code[^]*What colour fills transparent areas in a JPG output/);
  assert.match(webp, /formats\.json, #357\) doesn't exist yet/);
  assert.match(webp, /The page's copy was written to the style guide\./);

  const m4a = section(text, "compress-m4a");
  assert.match(m4a, /The compressor asks for quality 0\.82/);
  assert.match(m4a, /ffmpeg -y -nostdin -i input\.m4a -vn -acodec aac -b:a 160k output\.m4a/);
  assert.doesNotMatch(m4a, /"aboutSection"/, "a compressor has one format");

  const table = section(text, "csv-to-json");
  assert.match(table, /a batch sets only seo for it/);
  assert.doesNotMatch(table, /"faqs"/);
  assert.match(text, /## Appendix: docs\/table-converters\.md\n/);
});

test("a brief carries the format reference once it exists", () => {
  const formats = { webp: { name: "WebP", summary: "An image format." } };
  const webp = section(brief(["webp-to-png"], formats), "webp-to-png");
  assert.match(webp, /\*\*webp\*\* \(apps\/tools\/content\/formats\.json[^]*"summary": "An image format\."/);
  assert.match(webp, /\*\*png\*\* has no entry in apps\/tools\/content\/formats\.json/);
});

test("a brief's example is the FFmpeg one only when a Tool needs FFmpeg", () => {
  assert.match(brief(["mov-to-mp4"]), /## Example: mp4-to-mp3\n/);
  assert.match(brief(["heic-to-jpg"]), /## Example: webp-to-png\n/);
});

test("a brief refuses Tools that aren't live converters or compressors", () => {
  const retired = tools.find((tool) => !tool.isActive && tool.operation === "convert");
  assert.deepEqual(briefProblems(["webp-to-png", "no-such-tool", retired.id, "download-loom-videos"], tools), [
    "no-such-tool: no Tool has this id",
    `${retired.id}: the Tool is retired`,
    "download-loom-videos: not a converter or compressor (operation download)",
  ]);
});

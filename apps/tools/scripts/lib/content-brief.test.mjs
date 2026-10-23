import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBrief } from "./content-brief.mjs";
import { REGISTRY_PATH, STATUS_PATH, BATCH_DIR, splitRegistry } from "./content.mjs";
import { parseCsv } from "./csv.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(appRoot, "../..");
const read = (file) => readFileSync(file, "utf8");
const tools = splitRegistry(read(path.join(appRoot, REGISTRY_PATH))).map((entry) => JSON.parse(entry));
const statusRows = parseCsv(read(path.join(appRoot, STATUS_PATH)));
const examples = JSON.parse(read(path.join(appRoot, BATCH_DIR, "examples.json")));

const withKeyword = statusRows.find((row) => row.tool_id && row.keyword && row.operation === "convert");
const withoutKeyword = statusRows.find((row) => row.tool_id && !row.keyword && row.operation === "compress");

const brief = (ids, keywordIdeas) =>
  buildBrief({
    name: "test",
    ids,
    tools,
    statusRows,
    formats: null,
    styleGuide: "# Guide\n\ntext",
    examples,
    readDoc: (doc) => read(path.join(repoRoot, doc)),
    keywordIdeas,
  });

const terms = Array.from({ length: 10 }, (_, i) => ({ keyword: `term ${i}`, volume: 1000 - i }));
const questions = [
  { keyword: "what is a thing", volume: 50 },
  ...Array.from({ length: 6 }, (_, i) => ({ keyword: `how to question ${i}`, volume: 900 - i })),
];

test("with data: the top 8 terms and top 5 questions are listed with volumes", () => {
  const id = withKeyword.tool_id;
  const text = brief([id], { source: "ahrefs-test", country: "us", tools: { [id]: { keyword: withKeyword.keyword, volume: 5, terms, questions } } });
  assert.match(text, /Source: ahrefs-test, US volumes/);
  assert.match(text, /- term 0: 1,000 a month/);
  assert.match(text, /- term 7: 993 a month/);
  assert.doesNotMatch(text, /term 8/);
  assert.match(text, /- how to question 4: 896 a month/);
  assert.doesNotMatch(text, /how to question 5/);
  assert.match(text, /use the top "how to" question, "how to question 0"/);
  assert.match(text, /FAQs answer the listed questions/);
  assert.doesNotMatch(text, /No variant data for this Tool/);
});

test("without data: the brief says so and keeps the current behaviour", () => {
  const id = withKeyword.tool_id;
  for (const ideas of [null, { source: "x", tools: {} }]) {
    const text = brief([id], ideas);
    assert.match(text, /No variant data/);
    assert.match(text, new RegExp(`Keyword: \\*\\*${withKeyword.keyword}\\*\\*`));
  }
});

test("a Tool with no CSV keyword uses the data file's head keyword and volume", () => {
  const id = withoutKeyword.tool_id;
  assert.match(brief([id], null), /No keyword is assigned to this Tool/);
  const text = brief([id], { source: "ahrefs-test", country: "us", tools: { [id]: { keyword: "compress thing", volume: 12345, terms: [], questions: [] } } });
  assert.match(text, /Keyword: \*\*compress thing\*\*, 12,345 searches a month \(ahrefs-test, US\)/);
  assert.doesNotMatch(text, /No keyword is assigned to this Tool/);
});

test("download name: image compressors add _compressed, other Tools take the target extension", () => {
  assert.match(brief(["compress-jpg"], null), /"<name>_compressed\.jpg"/);
  assert.match(brief(["compress-gif"], null), /"<name>\.gif"/);
  assert.match(brief(["webp-to-png"], null), /"<name>\.png"/);
});

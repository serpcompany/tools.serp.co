// Writes one self-contained Markdown brief for a batch of converter and
// compressor copy (docs/converter-copy.md): per Tool, its keyword and
// volumes, its engine and what that engine really does, the format reference
// (apps/tools/content/formats.json, once #357 adds it), its current copy and
// an entry to fill in; its keyword variants and questions come from
// benchmarks/keyword-ideas.json when that exists; once, the style guide and a finished example.
//
//   pnpm content:brief <tool-id>... [--name <batch>]
//
// The brief goes to tmp/content-briefs/<batch>.md at the repository root,
// which git ignores. <batch> defaults to the first Tool's id.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBrief, briefProblems } from "./lib/content-brief.mjs";
import { BATCH_DIR, REGISTRY_PATH, STATUS_PATH, splitRegistry } from "./lib/content.mjs";
import { parseCsv } from "./lib/csv.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");
const args = process.argv.slice(2);
const ids = [];
let name;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--name") name = args[++index];
  else ids.push(args[index]);
}

if (!ids.length) {
  console.error("Usage: pnpm content:brief <tool-id>... [--name <batch>]");
  process.exit(1);
}

const tools = splitRegistry(readFileSync(path.join(appRoot, REGISTRY_PATH), "utf8")).map((entry) => JSON.parse(entry));
const problems = briefProblems(ids, tools);
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

const read = (file) => readFileSync(file, "utf8");
const formatsPath = path.join(appRoot, "content/formats.json");
const ideasPath = path.join(appRoot, "benchmarks/keyword-ideas.json");
const batch = name ?? ids[0];
const brief = buildBrief({
  name: batch,
  ids,
  tools,
  statusRows: parseCsv(read(path.join(appRoot, STATUS_PATH))),
  keywordIdeas: existsSync(ideasPath) ? JSON.parse(read(ideasPath)) : null,
  formats: existsSync(formatsPath) ? JSON.parse(read(formatsPath)) : null,
  styleGuide: read(path.join(repoRoot, "docs/converter-copy.md")),
  examples: JSON.parse(read(path.join(appRoot, BATCH_DIR, "examples.json"))),
  readDoc: (doc) => read(path.join(repoRoot, doc)),
});

const outDir = path.join(repoRoot, "tmp/content-briefs");
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${batch}.md`);
writeFileSync(outPath, brief);
console.log(`Wrote ${path.relative(repoRoot, outPath)} for ${ids.length} Tool(s).`);

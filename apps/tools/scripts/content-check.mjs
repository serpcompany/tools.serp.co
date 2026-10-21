// Checks the copy of every live converter and compressor against the rules in
// docs/converter-copy.md: keyword in the title and H1, lengths, no two Tools
// with the same title, H1, description or FAQ answer, live links only, no
// invented changelog or blog posts, and the fields a written Tool needs.
//
//   pnpm content:check                  the catalog as it is (run by pnpm check)
//   pnpm content:check --batch <name>   the catalog with content/batches/<name>.json
//                                       applied in memory; nothing is written
//
// It exits 1 and lists each failure, one per line, when any rule is broken.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REGISTRY_PATH, applyBatch, checkContent, loadContext, readBatch, splitRegistry } from "./lib/content.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const batchIndex = args.indexOf("--batch");
const registry = readFileSync(path.join(appRoot, REGISTRY_PATH), "utf8");
const context = loadContext(appRoot);

let problems;
if (batchIndex >= 0) {
  const name = args[batchIndex + 1];
  if (!name) {
    console.error("--batch needs a batch name, such as --batch 01");
    process.exit(1);
  }
  const { batch, error } = readBatch(appRoot, name);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  const result = applyBatch(registry, batch, context);
  problems = result.problems;
  console.log(`Batch ${name}: ${Object.keys(batch).length} Tools, ${result.changed.length} would change.`);
} else {
  const tools = splitRegistry(registry).map((entry) => JSON.parse(entry));
  problems = checkContent(tools, context).map(({ toolId, rule, message }) => `${toolId} [${rule}] ${message}`);
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${problems.length} content problem(s). The rules are in docs/converter-copy.md.`);
  process.exit(1);
}
console.log("Converter and compressor copy passes every content check.");

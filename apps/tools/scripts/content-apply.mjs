// Writes a batch of converter and compressor copy into tools.json, the only
// way copy gets there (docs/converter-copy.md). A batch is
// content/batches/<name>.json, shaped
//
//   { "<tool-id>": { "seo": {...}, "tool": {...}, "faqs": [...],
//                    "aboutSection": {...}, "pairNotes": {...} } }
//
// and each field it gives replaces that field of the Tool's content (`tool`
// is merged: a batch sets only its title and subtitle).
//
//   pnpm content:apply <name>
//
// It refuses unknown or retired Tool ids and writes nothing unless the whole
// catalog then passes `pnpm content:check`. Only the named Tools' entries
// change, in the file's own layout; re-running a batch changes nothing.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REGISTRY_PATH, applyBatch, loadContext, readBatch } from "./lib/content.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2];
if (!name) {
  console.error("Usage: pnpm content:apply <batch>   (a name in apps/tools/content/batches)");
  process.exit(1);
}

const registryPath = path.join(appRoot, REGISTRY_PATH);
const registry = readFileSync(registryPath, "utf8");
const { batch, error } = readBatch(appRoot, name);
if (error) {
  console.error(error);
  process.exit(1);
}
const { text, changed, problems } = applyBatch(registry, batch, loadContext(appRoot));

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`\nNothing written: ${problems.length} problem(s). The rules are in docs/converter-copy.md.`);
  process.exit(1);
}
if (!changed.length) {
  console.log(`Batch ${name}: no change; tools.json already holds it.`);
} else {
  writeFileSync(registryPath, text);
  console.log(`Batch ${name}: wrote ${changed.length} Tool(s): ${changed.join(", ")}.`);
}

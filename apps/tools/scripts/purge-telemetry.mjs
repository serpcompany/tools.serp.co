#!/usr/bin/env node
// Deletes tool runs older than the retention period from a deployed D1
// (docs/telemetry.md). It isn't scheduled yet, so run it by hand about once a
// month:
//
//   pnpm -C apps/tools telemetry:purge --env production --dry-run
//   pnpm -C apps/tools telemetry:purge --env production

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { purgeExpiredToolRuns } from "./lib/telemetry-purge.mjs";

const ENVIRONMENTS = new Set(["staging", "production"]);
const wranglerConfig = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
// wrangler doesn't export its bin, so find it from its package.json.
function resolveWranglerBin() {
  const packageJsonPath = createRequire(import.meta.url).resolve("wrangler/package.json");
  const { bin } = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return path.join(path.dirname(packageJsonPath), typeof bin === "string" ? bin : bin.wrangler);
}

function parseArgs(argv) {
  const args = { env: "", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env") args.env = argv[++index] ?? "";
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg !== "--") throw new Error(`Unknown argument: ${arg}`);
  }
  if (!ENVIRONMENTS.has(args.env)) throw new Error("--env must be staging or production");
  return args;
}

function wranglerExecute(env) {
  return async (sql) => {
    const result = spawnSync(
      process.execPath,
      [
        wranglerBin,
        "d1",
        "execute",
        "SERP_TOOLS_DB",
        "--remote",
        "--config",
        wranglerConfig,
        "--env",
        env,
        "--command",
        sql,
        "--json",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.status !== 0) {
      throw new Error(`wrangler d1 execute failed:\n${result.stderr || result.stdout}`);
    }
    const [statement] = JSON.parse(result.stdout);
    return statement?.results ?? [];
  };
}

const args = parseArgs(process.argv.slice(2));
const wranglerBin = resolveWranglerBin();
const result = await purgeExpiredToolRuns({
  execute: wranglerExecute(args.env),
  dryRun: args.dryRun,
  log: (line) => console.log(line),
});

if (args.dryRun) {
  console.log(`${args.env}: ${result.expired} runs older than ${result.cutoff} would be deleted.`);
} else {
  console.log(`${args.env}: deleted ${result.deleted} runs older than ${result.cutoff}.`);
  if (!result.complete) console.log("Stopped at the batch limit; run it again to continue.");
}

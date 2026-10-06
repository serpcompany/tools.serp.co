#!/usr/bin/env node
// Deletes tool runs older than the retention period from a deployed D1
// (docs/telemetry.md). It isn't scheduled yet, so run it by hand about once a
// month. With --device-id it instead deletes one visitor's runs.
//
//   pnpm -C apps/tools telemetry:purge --env production --dry-run
//   pnpm -C apps/tools telemetry:purge --env production
//   pnpm -C apps/tools telemetry:purge --env production --device-id <id>

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deleteDeviceRuns,
  parsePurgeArgs,
  parseWranglerExecuteOutput,
  purgeExpiredToolRuns,
  wranglerExecuteArgs,
} from "./lib/telemetry-purge.mjs";

const wranglerConfig = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
// wrangler doesn't export its bin, so find it from its package.json.
function resolveWranglerBin() {
  const packageJsonPath = createRequire(import.meta.url).resolve("wrangler/package.json");
  const { bin } = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return path.join(path.dirname(packageJsonPath), typeof bin === "string" ? bin : bin.wrangler);
}

function wranglerExecute(env) {
  return async (sql) => {
    const result = spawnSync(
      process.execPath,
      wranglerExecuteArgs({ wranglerBin, config: wranglerConfig, env, sql }),
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        `wrangler d1 execute failed:\n${[result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n")}`,
      );
    }
    return parseWranglerExecuteOutput(result.stdout);
  };
}

const args = parsePurgeArgs(process.argv.slice(2));
const wranglerBin = resolveWranglerBin();

if (args.deviceId !== undefined) {
  const removed = await deleteDeviceRuns({ execute: wranglerExecute(args.env), deviceId: args.deviceId });
  console.log(`${args.env}: deleted ${removed.deleted} runs for device ${removed.deviceId}.`);
  process.exit(0);
}

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

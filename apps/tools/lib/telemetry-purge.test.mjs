import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";

import { purgeExpiredToolRuns } from "../scripts/lib/telemetry-purge.mjs";

// Runs the purge command's loop against workerd's local D1 with the real
// migrations; the command itself only swaps in `wrangler d1 execute --remote`.
let proxy;
let d1;
const now = new Date("2026-10-06T00:00:00.000Z");
const day = 86_400_000;

before(async () => {
  proxy = await getPlatformProxy({
    configPath: fileURLToPath(
      new URL("../../../packages/tool-telemetry/test/wrangler.jsonc", import.meta.url),
    ),
    persist: false,
  });
  d1 = proxy.env.SERP_TOOLS_DB;
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    const statements = readFileSync(new URL(file, migrations), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await d1.batch(statements.map((statement) => d1.prepare(statement)));
  }
});

after(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  await d1.prepare("DELETE FROM tool_runs").run();
  const insert = d1.prepare(
    "INSERT INTO tool_runs (id, tool_id, status, started_at) VALUES (?, 'png-to-jpg', 'failed', ?)",
  );
  const expired = new Date(now.getTime() - 91 * day).toISOString();
  const kept = new Date(now.getTime() - 89 * day).toISOString();
  await d1.batch([
    ...Array.from({ length: 25 }, (_, i) => insert.bind(`old-${i}`, expired)),
    insert.bind("kept", kept),
  ]);
});

const execute = (sql) => d1.prepare(sql).all().then((result) => result.results);

async function remainingIds() {
  const { results } = await d1.prepare("SELECT id FROM tool_runs").all();
  return results.map((row) => row.id);
}

test("the purge deletes every expired run in batches and keeps the rest", async () => {
  const lines = [];
  const result = await purgeExpiredToolRuns({ execute, now, batchSize: 10, log: (line) => lines.push(line) });

  assert.deepEqual({ deleted: result.deleted, complete: result.complete }, { deleted: 25, complete: true });
  assert.deepEqual(await remainingIds(), ["kept"]);
  assert.deepEqual(lines, [
    "batch 1: deleted 10 (total 10)",
    "batch 2: deleted 10 (total 20)",
    "batch 3: deleted 5 (total 25)",
  ]);
});

test("the purge stops at maxBatches and the next run continues", async () => {
  const first = await purgeExpiredToolRuns({ execute, now, batchSize: 10, maxBatches: 2 });
  assert.deepEqual({ deleted: first.deleted, complete: first.complete }, { deleted: 20, complete: false });

  const second = await purgeExpiredToolRuns({ execute, now, batchSize: 10, maxBatches: 2 });
  assert.deepEqual({ deleted: second.deleted, complete: second.complete }, { deleted: 5, complete: true });
});

test("a dry run counts expired runs without deleting anything", async () => {
  const result = await purgeExpiredToolRuns({ execute, now, dryRun: true });

  assert.equal(result.expired, 25);
  assert.equal((await remainingIds()).length, 26);
});

test("the command refuses to run without a deployed environment", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/purge-telemetry.mjs", import.meta.url)), "--env", "local"],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--env must be staging or production/);
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";

import { runScheduledTelemetryPurge } from "./telemetry-purge.ts";

// Runs the cron's job against workerd's local D1 with the real migrations.
let proxy;
let d1;

before(async () => {
  proxy = await getPlatformProxy({
    configPath: new URL("../../../packages/tool-telemetry/test/wrangler.jsonc", import.meta.url)
      .pathname,
    persist: false,
  });
  d1 = proxy.env.SERP_TOOLS_DB;
  // Apply every migration as written, split on Drizzle's statement breakpoints.
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

function capturingLog() {
  const lines = [];
  return {
    lines,
    log: (...args) => lines.push(["log", ...args]),
    error: (...args) => lines.push(["error", ...args]),
  };
}

test("the scheduled job purges expired runs from SERP_TOOLS_DB and logs the result", async () => {
  const day = 86_400_000;
  const insert = d1.prepare(
    "INSERT INTO tool_runs (id, tool_id, status, started_at) VALUES (?, 'png-to-jpg', 'succeeded', ?)",
  );
  await d1.batch([
    insert.bind("expired", new Date(Date.now() - 91 * day).toISOString()),
    insert.bind("kept", new Date(Date.now() - 89 * day).toISOString()),
  ]);

  const log = capturingLog();
  const result = await runScheduledTelemetryPurge({ SERP_TOOLS_DB: d1 }, log);

  assert.equal(result.deleted, 1);
  const { results } = await d1.prepare("SELECT id FROM tool_runs").all();
  assert.deepEqual(results.map((row) => row.id), ["kept"]);
  assert.equal(log.lines[0][1], "telemetry purge");
});

test("the scheduled job rethrows and logs the reason when it fails", async () => {
  const missing = capturingLog();
  await assert.rejects(runScheduledTelemetryPurge({}, missing), /SERP_TOOLS_DB binding is missing/);
  assert.deepEqual(missing.lines, [["error", "telemetry purge failed", "SERP_TOOLS_DB binding is missing"]]);

  const broken = capturingLog();
  const binding = { prepare: () => { throw new Error("D1_ERROR: locked"); } };
  await assert.rejects(runScheduledTelemetryPurge({ SERP_TOOLS_DB: binding }, broken));
  assert.match(broken.lines[0][2], /purge stopped after deleting 0 runs: D1_ERROR: locked/);
});

test("the Worker entry wires OpenNext's handler and the cron, and wrangler uses it", () => {
  const entry = readFileSync(new URL("../worker-entry.mjs", import.meta.url), "utf8");
  assert.match(entry, /import handler from "\.\/\.open-next\/worker\.js";/);
  assert.match(entry, /fetch: handler\.fetch,/);
  assert.match(entry, /async scheduled\(_controller, env\) \{\s*await runScheduledTelemetryPurge\(env\);/);
  assert.match(
    entry,
    /export \{ BucketCachePurge, DOQueueHandler, DOShardedTagCache \} from "\.\/\.open-next\/worker\.js";/,
  );

  const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(wrangler.main, "worker-entry.mjs");
  for (const env of ["staging", "production"]) {
    assert.deepEqual(wrangler.env[env].triggers, { crons: ["23 3 * * *"] }, env);
    assert.equal(wrangler.env[env].d1_databases[0].binding, "SERP_TOOLS_DB", env);
  }
});

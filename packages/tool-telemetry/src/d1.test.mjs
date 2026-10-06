import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import { getPlatformProxy } from "wrangler";

import { STATUS_SAMPLE_LIMIT, getD1ToolsDashboardData } from "./d1.ts";
import {
  TOOL_RUN_RETENTION_DAYS,
  expiredCountSql,
  purgeBatchSql,
  purgeCutoff,
} from "./purge.ts";
import { recordToolRun } from "./server.ts";
import { METADATA_KEYS } from "./validate.ts";

// Runs against workerd's local D1, with the real migrations applied.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = new Date("2026-06-20T12:00:00.000Z");

let proxy;
let d1;

before(async () => {
  proxy = await getPlatformProxy({
    configPath: path.join(packageRoot, "test/wrangler.jsonc"),
    persist: false,
  });
  d1 = proxy.env.SERP_TOOLS_DB;
  await migrate(drizzle(d1), {
    migrationsFolder: path.join(packageRoot, "../../apps/tools/migrations"),
  });
});

after(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  await d1.batch([d1.prepare("DELETE FROM tool_runs"), d1.prepare("DELETE FROM tool_status")]);
});

function event(overrides = {}) {
  return {
    event: "tool_run_started",
    runId: "run-a",
    toolId: "compress-png",
    startedAt: "2026-06-20T10:00:00.000Z",
    inputBytes: 1000,
    metadata: { deviceId: "device-a" },
    ...overrides,
  };
}

async function run(id) {
  return d1.prepare("SELECT * FROM tool_runs WHERE id = ?").bind(id).first();
}

async function status(toolId) {
  return d1.prepare("SELECT * FROM tool_status WHERE tool_id = ?").bind(toolId).first();
}

// Wraps the binding so every statement adds its D1 rows_read to `reads`.
// Drizzle runs selects through raw(), which has no meta, so raw() and first()
// run all() first to measure the same statement.
function countingD1(binding, reads) {
  const measure = async (statement) => {
    const { meta } = await statement.all();
    reads.push(meta.rows_read);
  };
  const wrap = (statement) => ({
    bind: (...params) => wrap(statement.bind(...params)),
    async all() {
      const result = await statement.all();
      reads.push(result.meta.rows_read);
      return result;
    },
    async run() {
      const result = await statement.run();
      reads.push(result.meta.rows_read);
      return result;
    },
    async raw(options) {
      await measure(statement);
      return statement.raw(options);
    },
    async first(column) {
      await measure(statement);
      return statement.first(column);
    },
  });
  return { prepare: (query) => wrap(binding.prepare(query)) };
}

// Inserts `count` runs one second apart, the newest `offsetMs` before `now`.
async function seedRuns({ idPrefix, toolId, count, status, offsetMs = 60_000 }) {
  const insert = d1.prepare(
    "INSERT INTO tool_runs (id, tool_id, status, started_at, duration_ms) VALUES (?, ?, ?, ?, 10)",
  );
  const rows = Array.from({ length: count }, (_, i) =>
    insert.bind(
      `${idPrefix}-${i}`,
      toolId,
      status,
      new Date(now.getTime() - offsetMs - i * 1000).toISOString(),
    ),
  );
  for (let i = 0; i < rows.length; i += 500) {
    await d1.batch(rows.slice(i, i + 500));
  }
}

test("a valid started event inserts a tool_runs row", async () => {
  const result = await recordToolRun(event({ metadata: { urlHost: "example.com" } }), { d1, now });

  assert.deepEqual(result, { status: 200, body: { ok: true } });
  const row = await run("run-a");
  assert.equal(row.tool_id, "compress-png");
  assert.equal(row.status, "started");
  assert.equal(row.metadata, '{"urlHost":"example.com"}');
});

test("a repeated started event keeps the first row", async () => {
  await recordToolRun(event({ inputBytes: 1000, metadata: { rows: 1 } }), { d1, now });
  await recordToolRun(event({ inputBytes: 999, metadata: { rows: 2 } }), { d1, now });

  const row = await run("run-a");
  assert.equal(row.input_bytes, 1000);
  assert.equal(row.metadata, '{"rows":1}');
});

test("succeeded and failed events update the run", async () => {
  await recordToolRun(event(), { d1, now });
  await recordToolRun(
    event({ event: "tool_run_succeeded", durationMs: 100, outputBytes: 400 }),
    { d1, now },
  );
  await recordToolRun(
    event({
      event: "tool_run_failed",
      runId: "run-b",
      startedAt: "2026-06-20T11:00:00.000Z",
      durationMs: 300,
      errorCode: "download_failed",
    }),
    { d1, now },
  );

  const a = await run("run-a");
  assert.equal(a.status, "succeeded");
  assert.equal(a.duration_ms, 100);
  assert.equal(a.output_bytes, 400);
  const b = await run("run-b");
  assert.equal(b.status, "failed");
  assert.equal(b.error_code, "download_failed");
});

test("completed runs recompute tool_status and feed the dashboard", async () => {
  await recordToolRun(
    event({ event: "tool_run_succeeded", durationMs: 100, outputBytes: 400 }),
    { d1, now },
  );
  await recordToolRun(
    event({
      event: "tool_run_failed",
      runId: "run-b",
      startedAt: "2026-06-20T11:00:00.000Z",
      durationMs: 300,
      errorCode: "download_failed",
      metadata: { urlHost: "videos.example" },
    }),
    { d1, now },
  );

  const row = await status("compress-png");
  assert.equal(row.status, "broken");
  assert.equal(row.last_run_at, "2026-06-20T11:00:00.000Z");
  assert.equal(row.failure_rate_24h, 0.5);
  assert.equal(row.median_duration_ms, 200);
  assert.equal(row.median_reduction_pct, 60);

  const dashboard = await getD1ToolsDashboardData(d1, { now });
  assert.equal(dashboard.statusRows[0].toolId, "compress-png");
  assert.equal(dashboard.failureRows[0].count, 1);
  assert.deepEqual(dashboard.failureRows[0].sampleMetadata, { urlHost: "videos.example" });
});

test("started events do not trigger a status refresh", async () => {
  await recordToolRun(event(), { d1, now });
  assert.equal(await status("compress-png"), null);
});

test(`a completed event reads at most ${STATUS_SAMPLE_LIMIT} runs, however busy the tool`, async () => {
  // 499 recent successes, then 1,500 older failures still inside the 24h window.
  const toolId = "busy-tool";
  await seedRuns({ idPrefix: "new", toolId, count: STATUS_SAMPLE_LIMIT - 1, status: "succeeded" });
  await seedRuns({ idPrefix: "old", toolId, count: 1500, status: "failed", offsetMs: 3_600_000 });
  // Other tools' rows must not be scanned either.
  await seedRuns({ idPrefix: "other", toolId: "other-tool", count: 2000, status: "succeeded" });

  const reads = [];
  const result = await recordToolRun(
    event({
      event: "tool_run_succeeded",
      runId: "latest",
      toolId,
      startedAt: now.toISOString(),
      durationMs: 10,
    }),
    { d1: countingD1(d1, reads), now },
  );

  assert.deepEqual(result, { status: 200, body: { ok: true } });
  const rowsRead = reads.reduce((total, n) => total + n, 0);
  // One read for the upsert, then the capped status sample.
  assert.ok(rowsRead <= STATUS_SAMPLE_LIMIT + 1, `read ${rowsRead} rows`);

  // The older failures fall outside the sample, so the tool reads as healthy.
  const row = await status(toolId);
  assert.equal(row.failure_rate_24h, 0);
  assert.equal(row.status, "live");
});

test("invalid payloads are rejected with stable codes and nothing is written", async () => {
  const cases = [
    [null, "invalid_payload"],
    [event({ event: "tool_run_exploded" }), "invalid_event"],
    [event({ runId: "x".repeat(81) }), "invalid_run_id"],
    [event({ toolId: "../etc/passwd" }), "invalid_tool_id"],
    [event({ startedAt: "not a date" }), "invalid_started_at"],
    [event({ startedAt: "2030-01-01T00:00:00.000Z" }), "invalid_started_at"],
    [event({ durationMs: -1 }), "invalid_number"],
    [event({ inputBytes: "1000" }), "invalid_number"],
    [event({ errorCode: "<script>" }), "invalid_error_code"],
  ];
  for (const [payload, code] of cases) {
    const result = await recordToolRun(payload, { d1, now });
    assert.deepEqual(result, { status: 400, body: { ok: false, error: code } }, code);
  }
  const { results } = await d1.prepare("SELECT count(*) AS n FROM tool_runs").all();
  assert.equal(results[0].n, 0);
});

test("an odd from/to label is dropped without losing the event", async () => {
  const result = await recordToolRun(event({ from: "Twitter/X", to: "mp4" }), { d1, now });

  assert.deepEqual(result, { status: 200, body: { ok: true } });
  assert.equal((await run("run-a")).status, "started");
});

test("only allowlisted metadata keys are stored", async () => {
  await recordToolRun(
    event({
      metadata: {
        engine: "worker",
        fileName: "passport-scan.pdf",
        detail: "ENOENT: /Users/someone/file.txt",
        "bad key!": "dropped",
        failFast: true,
      },
    }),
    { d1, now },
  );

  assert.deepEqual(JSON.parse((await run("run-a")).metadata), { engine: "worker", failFast: true });
});

test("metadata is flattened and capped before it is stored", async () => {
  const keys = [...METADATA_KEYS];
  await recordToolRun(
    event({
      metadata: {
        userAgent: "a".repeat(1000),
        engine: { deep: { value: 1 } },
        ...Object.fromEntries(keys.slice(5, 35).map((key, i) => [key, i])),
      },
    }),
    { d1, now },
  );

  const metadata = JSON.parse((await run("run-a")).metadata);
  assert.equal(metadata.userAgent.length, 256);
  assert.equal(metadata.engine, '{"deep":{"value":1}}');
  assert.equal(Object.keys(metadata).length, 20);
});

test(`a purge batch deletes only runs older than ${TOOL_RUN_RETENTION_DAYS} days, at most batchSize`, async () => {
  const day = 86_400_000;
  const expiredOffset = (TOOL_RUN_RETENTION_DAYS + 1) * day;
  await seedRuns({ idPrefix: "old-ok", toolId: "busy-tool", count: 13, status: "succeeded", offsetMs: expiredOffset });
  await seedRuns({ idPrefix: "old-bad", toolId: "busy-tool", count: 12, status: "failed", offsetMs: expiredOffset });
  await seedRuns({ idPrefix: "recent", toolId: "busy-tool", count: 5, status: "succeeded", offsetMs: (TOOL_RUN_RETENTION_DAYS - 1) * day });
  const cutoff = purgeCutoff(now);

  const counted = await d1.prepare(expiredCountSql(cutoff)).first();
  assert.equal(counted.expired, 25);

  const batches = [];
  for (;;) {
    const { results } = await d1.prepare(purgeBatchSql(cutoff, 10)).all();
    batches.push(results.length);
    if (results.length < 10) break;
  }
  assert.deepEqual(batches, [10, 10, 5]);
  const { results } = await d1.prepare("SELECT id FROM tool_runs ORDER BY id").all();
  assert.deepEqual(results.map((row) => row.id), ["recent-0", "recent-1", "recent-2", "recent-3", "recent-4"]);
});

test("a purge batch with nothing expired reads almost nothing, however big the table", async () => {
  await seedRuns({ idPrefix: "recent", toolId: "busy-tool", count: 3000, status: "succeeded" });

  const { results, meta } = await d1.prepare(purgeBatchSql(purgeCutoff(now))).all();

  assert.equal(results.length, 0);
  // The (status, started_at) index finds no expired rows without a table scan.
  assert.ok(meta.rows_read < 10, `read ${meta.rows_read} rows`);
});

test("the purge SQL only accepts an ISO timestamp cutoff and a positive batch size", () => {
  assert.equal(purgeCutoff(now), "2026-03-22T12:00:00.000Z");
  for (const cutoff of ["2026-01-01", "2026-01-01T00:00:00.000Z' OR '1'='1", ""]) {
    assert.throws(() => purgeBatchSql(cutoff), /Invalid purge cutoff/, cutoff);
    assert.throws(() => expiredCountSql(cutoff), /Invalid purge cutoff/, cutoff);
  }
  assert.throws(() => purgeBatchSql(purgeCutoff(now), 0), /Invalid purge batch size/);
});

test("a missing D1 binding returns 503 instead of discarding telemetry", async () => {
  const result = await recordToolRun(event(), { now });
  assert.deepEqual(result, { status: 503, body: { ok: false, error: "d1_unavailable" } });
});

test("D1 failures return a stable code, not the database message", async () => {
  const broken = {
    prepare() {
      throw new Error("D1_ERROR: no such table: tool_runs: SQLITE_ERROR");
    },
  };
  const result = await recordToolRun(event({ event: "tool_run_succeeded" }), { d1: broken, now });
  assert.deepEqual(result, { status: 500, body: { ok: false, error: "d1_write_failed" } });
});

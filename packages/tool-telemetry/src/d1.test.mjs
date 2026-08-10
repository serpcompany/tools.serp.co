import test from "node:test";
import assert from "node:assert/strict";
import { getD1ToolsDashboardData } from "./d1.ts";
import { recordToolRun } from "./server.ts";

class FakeStatement {
  constructor(db, query) {
    this.db = db;
    this.query = query.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.query.includes("INSERT OR IGNORE INTO tool_runs")) {
      this.db.insertRun(this.values, { ignoreExisting: true });
      return { success: true };
    }

    if (this.query.includes("INSERT INTO tool_runs")) {
      this.db.insertRun(this.values, { ignoreExisting: false });
      return { success: true };
    }

    if (this.query.includes("INSERT INTO tool_status")) {
      this.db.upsertStatus(this.values);
      return { success: true };
    }

    throw new Error(`Unhandled run query: ${this.query}`);
  }

  async all() {
    if (this.query.includes("SELECT DISTINCT tool_id AS toolId")) {
      return { results: this.db.distinctToolIds() };
    }

    if (this.query.includes("FROM tool_status")) {
      return { results: this.db.statusRows() };
    }

    if (this.query.includes("GROUP BY tool_id, error_code")) {
      return { results: this.db.failureCounts(this.values[0]) };
    }

    if (this.query.includes("LIMIT 200")) {
      return { results: this.db.recentFailures(this.values[0]) };
    }

    if (this.query.includes("WHERE tool_id = ? AND started_at >= ?")) {
      return { results: this.db.runsForTool(this.values[0], this.values[1]) };
    }

    throw new Error(`Unhandled all query: ${this.query}`);
  }

  async first() {
    const results = await this.all();
    return results.results?.[0] ?? null;
  }
}

class FakeD1 {
  constructor() {
    this.runs = new Map();
    this.statuses = new Map();
  }

  prepare(query) {
    return new FakeStatement(this, query);
  }

  insertRun(values, { ignoreExisting }) {
    const [
      id,
      toolId,
      status,
      startedAt,
      durationMs,
      inputBytes,
      outputBytes,
      errorCode,
      metadata,
    ] = values;

    if (ignoreExisting && this.runs.has(id)) return;

    this.runs.set(id, {
      id,
      tool_id: toolId,
      status,
      started_at: startedAt,
      duration_ms: durationMs,
      input_bytes: inputBytes,
      output_bytes: outputBytes,
      error_code: errorCode,
      metadata,
    });
  }

  upsertStatus(values) {
    const [
      toolId,
      status,
      lastRunAt,
      failureRate24h,
      medianDurationMs,
      medianReductionPct,
      updatedAt,
    ] = values;

    this.statuses.set(toolId, {
      toolId,
      status,
      lastRunAt,
      failureRate24h,
      medianDurationMs,
      medianReductionPct,
      updatedAt,
    });
  }

  distinctToolIds() {
    return Array.from(new Set(Array.from(this.runs.values()).map((row) => row.tool_id)))
      .sort()
      .map((toolId) => ({ toolId }));
  }

  statusRows() {
    return Array.from(this.statuses.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  runsForTool(toolId, since) {
    return Array.from(this.runs.values())
      .filter((row) => row.tool_id === toolId && row.started_at >= since)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }

  failureCounts(since) {
    const grouped = new Map();
    for (const row of this.runs.values()) {
      if (row.status !== "failed" || row.started_at < since) continue;
      const key = `${row.tool_id}::${row.error_code ?? "unknown"}`;
      const existing = grouped.get(key) ?? {
        toolId: row.tool_id,
        errorCode: row.error_code,
        count: 0,
        lastSeen: null,
      };
      existing.count += 1;
      if (!existing.lastSeen || row.started_at > existing.lastSeen) {
        existing.lastSeen = row.started_at;
      }
      grouped.set(key, existing);
    }
    return Array.from(grouped.values()).sort((a, b) => b.count - a.count);
  }

  recentFailures(since) {
    return Array.from(this.runs.values())
      .filter((row) => row.status === "failed" && row.started_at >= since)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 200)
      .map((row) => ({
        toolId: row.tool_id,
        errorCode: row.error_code,
        metadata: row.metadata,
        startedAt: row.started_at,
      }));
  }
}

const now = new Date("2026-06-20T12:00:00.000Z");

function event(overrides) {
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

test("valid telemetry event inserts a D1 tool_runs row", async () => {
  const db = new FakeD1();
  const result = await recordToolRun(event({ metadata: { host: "example.com" } }), {
    d1: db,
    now,
  });

  assert.deepEqual(result.body, { ok: true });
  assert.equal(db.runs.get("run-a").tool_id, "compress-png");
  assert.equal(db.runs.get("run-a").status, "started");
  assert.equal(db.runs.get("run-a").metadata, '{"host":"example.com"}');
});

test("started event uses insert-or-ignore", async () => {
  const db = new FakeD1();
  await recordToolRun(event({ inputBytes: 1000, metadata: { version: 1 } }), { d1: db, now });
  await recordToolRun(event({ inputBytes: 999, metadata: { version: 2 } }), { d1: db, now });

  assert.equal(db.runs.size, 1);
  assert.equal(db.runs.get("run-a").input_bytes, 1000);
  assert.equal(db.runs.get("run-a").metadata, '{"version":1}');
});

test("succeeded and failed events upsert existing D1 runs", async () => {
  const db = new FakeD1();
  await recordToolRun(event({ inputBytes: 1000 }), { d1: db, now });
  await recordToolRun(
    event({
      event: "tool_run_succeeded",
      durationMs: 100,
      outputBytes: 400,
      metadata: { phase: "done" },
    }),
    { d1: db, now }
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
    { d1: db, now }
  );

  assert.equal(db.runs.get("run-a").status, "succeeded");
  assert.equal(db.runs.get("run-a").duration_ms, 100);
  assert.equal(db.runs.get("run-a").output_bytes, 400);
  assert.equal(db.runs.get("run-b").status, "failed");
  assert.equal(db.runs.get("run-b").error_code, "download_failed");
});

test("tool_status recalculates failure rate, medians, reduction, and last run", async () => {
  const db = new FakeD1();
  await recordToolRun(
    event({
      event: "tool_run_succeeded",
      durationMs: 100,
      outputBytes: 400,
    }),
    { d1: db, now }
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
    { d1: db, now }
  );

  const status = db.statuses.get("compress-png");
  assert.equal(status.status, "broken");
  assert.equal(status.lastRunAt, "2026-06-20T11:00:00.000Z");
  assert.equal(status.failureRate24h, 0.5);
  assert.equal(status.medianDurationMs, 200);
  assert.equal(status.medianReductionPct, 60);

  const dashboard = await getD1ToolsDashboardData(db, { now });
  assert.equal(dashboard.failureRows[0].count, 1);
  assert.deepEqual(dashboard.failureRows[0].sampleMetadata, { urlHost: "videos.example" });
});

test("missing D1 binding fails instead of discarding telemetry", async () => {
  const result = await recordToolRun(event({}));
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, {
    ok: false,
    error: "D1 telemetry binding unavailable",
  });
});

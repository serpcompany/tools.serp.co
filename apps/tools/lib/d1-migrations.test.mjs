import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(appRoot, "migrations");

function sqlFiles(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
}

function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  for (const name of sqlFiles(migrationsDir)) {
    db.exec(readFileSync(path.join(migrationsDir, name), "utf8"));
  }
  return db;
}

test("the Drizzle schema has no changes missing from the migrations", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "d1-drift-"));
  try {
    cpSync(migrationsDir, scratch, { recursive: true });
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "drizzle-kit",
        "generate",
        "--dialect",
        "sqlite",
        "--schema",
        "../../packages/tool-telemetry/src/schema.ts",
        "--out",
        scratch,
      ],
      { cwd: appRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(
      sqlFiles(scratch),
      sqlFiles(migrationsDir),
      "Schema changed without a migration. Run `pnpm -C apps/tools db:generate`.",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("migrations create the telemetry tables and indexes", () => {
  const db = migratedDatabase();
  const objects = db
    .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => `${row.type}:${row.name}`);
  assert.deepEqual(objects, [
    "index:idx_tool_runs_status_started_at",
    "index:idx_tool_runs_tool_id_started_at",
    "table:tool_runs",
    "table:tool_status",
  ]);
});

test("migrations enforce the status and metadata constraints", () => {
  const db = migratedDatabase();
  const insert = db.prepare(
    "INSERT INTO tool_runs (id, tool_id, status, started_at, metadata) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run("ok", "png-to-jpg", "succeeded", "2026-10-06T00:00:00.000Z", '{"a":1}');
  assert.throws(() => insert.run("bad-status", "png-to-jpg", "done", "2026-10-06T00:00:00.000Z", null));
  assert.throws(() => insert.run("bad-json", "png-to-jpg", "failed", "2026-10-06T00:00:00.000Z", "{"));
});

// Production already has these tables from the retired 0001_tool_telemetry.sql,
// so the baseline must be a no-op when applied there.
test("the baseline migration is a no-op over the pre-Drizzle schema", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tool_runs (
      id TEXT PRIMARY KEY NOT NULL, tool_id TEXT NOT NULL, status TEXT NOT NULL,
      started_at TEXT NOT NULL, duration_ms INTEGER, input_bytes INTEGER,
      output_bytes INTEGER, error_code TEXT, metadata TEXT
    );
    CREATE INDEX idx_tool_runs_tool_id_started_at ON tool_runs (tool_id, started_at);
    CREATE INDEX idx_tool_runs_status_started_at ON tool_runs (status, started_at);
    CREATE TABLE tool_status (
      tool_id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, last_run_at TEXT,
      failure_rate_24h REAL, median_duration_ms INTEGER, median_reduction_pct REAL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(readFileSync(path.join(migrationsDir, "0000_tool_telemetry.sql"), "utf8"));
});

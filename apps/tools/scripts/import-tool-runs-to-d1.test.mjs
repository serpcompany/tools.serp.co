import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStatusRows,
  buildToolRunUpsertSql,
  extractCountFromD1Json,
  normalizeRows,
  parseCsvRows,
  parseJsonRows,
} from "./import-tool-runs-to-d1.mjs";

test("import parser reads JSON rows and stores metadata as JSON text", () => {
  const source = JSON.stringify([
    {
      id: "run-1",
      tool_id: "compress-png",
      status: "succeeded",
      started_at: "2026-06-20 10:00:00.000+00",
      duration_ms: 120,
      input_bytes: 1000,
      output_bytes: 400,
      error_code: null,
      metadata: { deviceId: "device-a", urlHost: "example.com" },
    },
  ]);

  const rows = normalizeRows(parseJsonRows(source));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].startedAt, "2026-06-20T10:00:00.000Z");
  assert.equal(rows[0].metadataJson, '{"deviceId":"device-a","urlHost":"example.com"}');
});

test("import parser reads CSV rows and preserves source row count", () => {
  const source = [
    '"id","tool_id","status","started_at","duration_ms","input_bytes","output_bytes","error_code","metadata"',
    '"run-1","compress-png","started","2026-06-20 10:00:00.000+00","","1000","","","{""deviceId"":""device-a""}"',
    '"run-2","compress-png","failed","2026-06-20 11:00:00.000+00","300","1000","","download_failed","{""urlHost"":""example.com""}"',
  ].join("\n");

  const rows = normalizeRows(parseCsvRows(source));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].metadataJson, '{"deviceId":"device-a"}');
  assert.equal(rows[1].errorCode, "download_failed");
});

test("tool run import SQL upserts by id and is safe to re-run", () => {
  const rows = normalizeRows([
    {
      id: "run-1",
      tool_id: "compress-png",
      status: "succeeded",
      started_at: "2026-06-20T10:00:00.000Z",
      duration_ms: 120,
      input_bytes: 1000,
      output_bytes: 400,
      metadata: { note: "user's sample" },
    },
  ]);

  const sql = buildToolRunUpsertSql(rows);

  assert.match(sql, /INSERT INTO tool_runs/);
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(sql, /user''s sample/);
});

test("status rows regenerate failure rate, medians, and last run from imported rows", () => {
  const rows = normalizeRows([
    {
      id: "run-1",
      tool_id: "compress-png",
      status: "succeeded",
      started_at: "2026-06-20T10:00:00.000Z",
      duration_ms: 100,
      input_bytes: 1000,
      output_bytes: 400,
    },
    {
      id: "run-2",
      tool_id: "compress-png",
      status: "failed",
      started_at: "2026-06-20T11:00:00.000Z",
      duration_ms: 300,
      input_bytes: 1000,
      error_code: "download_failed",
    },
  ]);

  const statusRows = buildStatusRows(rows, new Date("2026-06-20T12:00:00.000Z"));

  assert.equal(statusRows.length, 1);
  assert.equal(statusRows[0].status, "broken");
  assert.equal(statusRows[0].lastRunAt, "2026-06-20T11:00:00.000Z");
  assert.equal(statusRows[0].failureRate24h, 0.5);
  assert.equal(statusRows[0].medianDurationMs, 200);
  assert.equal(statusRows[0].medianReductionPct, 60);
});

test("D1 JSON count parser supports wrangler execute output", () => {
  const count = extractCountFromD1Json(JSON.stringify([{ results: [{ count: 4150 }] }]));
  assert.equal(count, 4150);
});

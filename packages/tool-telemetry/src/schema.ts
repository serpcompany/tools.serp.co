import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Source of truth for the SERP_TOOLS_DB D1 schema. Run `pnpm db:generate`
// after changing it; migrations land in apps/tools/migrations.

export const toolRuns = sqliteTable(
  "tool_runs",
  {
    id: text("id").primaryKey().notNull(),
    toolId: text("tool_id").notNull(),
    status: text("status", {
      enum: ["started", "succeeded", "failed", "handed_off", "abandoned"],
    }).notNull(),
    startedAt: text("started_at").notNull(),
    durationMs: integer("duration_ms"),
    inputBytes: integer("input_bytes"),
    outputBytes: integer("output_bytes"),
    errorCode: text("error_code"),
    metadata: text("metadata"),
  },
  (table) => [
    index("idx_tool_runs_tool_id_started_at").on(table.toolId, table.startedAt),
    index("idx_tool_runs_status_started_at").on(table.status, table.startedAt),
    check(
      "tool_runs_status_check",
      sql`${table.status} IN ('started', 'succeeded', 'failed', 'handed_off', 'abandoned')`,
    ),
    check(
      "tool_runs_metadata_check",
      sql`${table.metadata} IS NULL OR json_valid(${table.metadata})`,
    ),
  ],
);

export const toolStatus = sqliteTable("tool_status", {
  toolId: text("tool_id").primaryKey().notNull(),
  status: text("status").notNull(),
  lastRunAt: text("last_run_at"),
  failureRate24h: real("failure_rate_24h"),
  medianDurationMs: integer("median_duration_ms"),
  medianReductionPct: real("median_reduction_pct"),
  updatedAt: text("updated_at").notNull(),
});

export type ToolRunRow = typeof toolRuns.$inferSelect;
export type NewToolRunRow = typeof toolRuns.$inferInsert;
export type ToolStatusRow = typeof toolStatus.$inferSelect;

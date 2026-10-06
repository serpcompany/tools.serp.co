import { and, count, desc, eq, gte, inArray, lt, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { median, summarizeToolRuns } from "./metrics.ts";
import { toolRuns, toolStatus } from "./schema.ts";
import type { ToolRunEvent, ToolRunRecord, ToolRunStatus } from "./types.ts";

export type D1DatabaseLike = Parameters<typeof drizzle>[0];

export type D1ToolStatusRow = {
  toolId: string;
  status: string;
  lastRunAt: string | null;
  failureRate24h: number | null;
  medianDurationMs: number | null;
  medianReductionPct: number | null;
  updatedAt: string;
};

export type D1FailureSummary = {
  toolId: string;
  errorCode: string | null;
  count: number;
  lastSeen: string | null;
  sampleMetadata: Record<string, unknown> | null;
};

type UpdateToolStatusOptions = {
  now?: Date;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Upper bound on rows read per status refresh, whatever a tool's traffic.
export const STATUS_SAMPLE_LIMIT = 500;
// Tool runs are kept this long, then deleted by the daily purge (docs/telemetry.md).
export const TOOL_RUN_RETENTION_DAYS = 90;
export const PURGE_BATCH_SIZE = 1000;
const MAX_PURGE_BATCHES = 50;
const RUN_STATUSES = ["started", "succeeded", "failed"] as const;
const RECENT_FAILURE_SAMPLE_LIMIT = 200;

export function isD1DatabaseLike(value: unknown): value is D1DatabaseLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

function db(binding: D1DatabaseLike) {
  return drizzle(binding);
}

function toStatus(event: ToolRunEvent): ToolRunStatus {
  if (event.event === "tool_run_started") return "started";
  if (event.event === "tool_run_succeeded") return "succeeded";
  return "failed";
}

function toNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringifyMetadata(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const json = JSON.stringify(value);
  return json === undefined ? null : json;
}

export function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function updateD1ToolStatus(
  binding: D1DatabaseLike,
  toolId: string,
  options: UpdateToolStatusOptions = {}
) {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - ONE_DAY_MS).toISOString();

  const rows = await db(binding)
    .select({
      status: toolRuns.status,
      startedAt: toolRuns.startedAt,
      durationMs: toolRuns.durationMs,
      inputBytes: toolRuns.inputBytes,
      outputBytes: toolRuns.outputBytes,
    })
    .from(toolRuns)
    .where(and(eq(toolRuns.toolId, toolId), gte(toolRuns.startedAt, since)))
    .orderBy(desc(toolRuns.startedAt))
    .limit(STATUS_SAMPLE_LIMIT);

  const runs: ToolRunRecord[] = rows.map((row) => ({
    toolId,
    status: row.status,
    startedAt: new Date(row.startedAt),
    durationMs: row.durationMs,
    inputBytes: row.inputBytes,
    outputBytes: row.outputBytes,
  }));

  const summary = summarizeToolRuns(runs);
  const completed = runs.filter((run) => run.status === "succeeded" || run.status === "failed");

  const reductionSamples = completed
    .filter((run) => run.status === "succeeded")
    .map((run) => {
      const input = toNumber(run.inputBytes);
      const output = toNumber(run.outputBytes);
      if (!input || !output) return null;
      return Math.round((1 - output / input) * 100);
    })
    .filter((value): value is number => value !== null);

  let status = "unknown";
  if (completed.length) {
    status = "live";
    if (summary.failureRate !== null && summary.failureRate >= 0.5) {
      status = "broken";
    } else if (summary.failureRate !== null && summary.failureRate >= 0.2) {
      status = "degraded";
    }
  }

  const values = {
    status,
    lastRunAt: rows[0]?.startedAt ?? null,
    failureRate24h: summary.failureRate,
    medianDurationMs: summary.medianDurationMs,
    medianReductionPct: median(reductionSamples),
    updatedAt: now.toISOString(),
  };

  await db(binding)
    .insert(toolStatus)
    .values({ toolId, ...values })
    .onConflictDoUpdate({ target: toolStatus.toolId, set: values });
}

export async function rebuildD1ToolStatuses(
  binding: D1DatabaseLike,
  options: UpdateToolStatusOptions = {}
) {
  const rows = await db(binding)
    .selectDistinct({ toolId: toolRuns.toolId })
    .from(toolRuns)
    .orderBy(toolRuns.toolId);

  for (const row of rows) {
    await updateD1ToolStatus(binding, row.toolId, options);
  }

  return rows.length;
}

// Expects an event already normalized by parseToolRunEvent.
export async function recordToolRunInD1(
  binding: D1DatabaseLike,
  payload: ToolRunEvent,
  options: UpdateToolStatusOptions = {}
) {
  const status = toStatus(payload);
  const fields = {
    toolId: payload.toolId,
    status,
    startedAt: payload.startedAt,
    durationMs: toNumber(payload.durationMs),
    inputBytes: toNumber(payload.inputBytes),
    outputBytes: toNumber(payload.outputBytes),
    errorCode: payload.errorCode ?? null,
    metadata: stringifyMetadata(payload.metadata ?? null),
  };
  const row = { id: payload.runId, ...fields };

  if (status === "started") {
    await db(binding).insert(toolRuns).values(row).onConflictDoNothing();
    return;
  }

  await db(binding)
    .insert(toolRuns)
    .values(row)
    .onConflictDoUpdate({ target: toolRuns.id, set: fields });

  // Status only depends on completed runs, so starts don't trigger a refresh.
  await updateD1ToolStatus(binding, payload.toolId, options);
}

export async function getD1ToolsDashboardData(
  binding: D1DatabaseLike,
  options: UpdateToolStatusOptions = {}
): Promise<{ statusRows: D1ToolStatusRow[]; failureRows: D1FailureSummary[] }> {
  const statusRows = await db(binding)
    .select()
    .from(toolStatus)
    .orderBy(desc(toolStatus.updatedAt));

  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - ONE_DAY_MS).toISOString();
  const failedSince = and(eq(toolRuns.status, "failed"), gte(toolRuns.startedAt, since));

  const lastSeen = max(toolRuns.startedAt);
  const failureCount = count();
  const failureCounts = await db(binding)
    .select({
      toolId: toolRuns.toolId,
      errorCode: toolRuns.errorCode,
      count: failureCount,
      lastSeen,
    })
    .from(toolRuns)
    .where(failedSince)
    .groupBy(toolRuns.toolId, toolRuns.errorCode)
    .orderBy(desc(failureCount), desc(lastSeen));

  const recentFailures = await db(binding)
    .select({
      toolId: toolRuns.toolId,
      errorCode: toolRuns.errorCode,
      metadata: toolRuns.metadata,
    })
    .from(toolRuns)
    .where(failedSince)
    .orderBy(desc(toolRuns.startedAt))
    .limit(RECENT_FAILURE_SAMPLE_LIMIT);

  const sampleMetadataByKey = new Map<string, Record<string, unknown>>();
  for (const row of recentFailures) {
    const metadata = parseMetadata(row.metadata);
    if (!metadata) continue;
    const key = `${row.toolId}::${row.errorCode ?? "unknown"}`;
    if (!sampleMetadataByKey.has(key)) {
      sampleMetadataByKey.set(key, metadata);
    }
  }

  return {
    statusRows: statusRows.map((row) => ({
      toolId: row.toolId,
      status: row.status,
      lastRunAt: row.lastRunAt,
      failureRate24h: row.failureRate24h,
      medianDurationMs: row.medianDurationMs,
      medianReductionPct: row.medianReductionPct,
      updatedAt: row.updatedAt,
    })),
    failureRows: failureCounts.map((row) => ({
      toolId: row.toolId,
      errorCode: row.errorCode,
      count: row.count,
      lastSeen: row.lastSeen ?? null,
      sampleMetadata:
        sampleMetadataByKey.get(`${row.toolId}::${row.errorCode ?? "unknown"}`) ?? null,
    })),
  };
}

type PurgeOptions = {
  now?: Date;
  retentionDays?: number;
};

// Deletes tool runs older than the retention period, in batches so one call
// stays bounded. Filtering on every status lets SQLite use the
// (status, started_at) index instead of scanning the table.
export async function purgeExpiredToolRuns(
  binding: D1DatabaseLike,
  options: PurgeOptions = {}
): Promise<{ deleted: number; cutoff: string; complete: boolean }> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? TOOL_RUN_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - retentionDays * ONE_DAY_MS).toISOString();

  let deleted = 0;
  for (let batch = 0; batch < MAX_PURGE_BATCHES; batch += 1) {
    const expired = db(binding)
      .select({ id: toolRuns.id })
      .from(toolRuns)
      .where(and(inArray(toolRuns.status, [...RUN_STATUSES]), lt(toolRuns.startedAt, cutoff)))
      .limit(PURGE_BATCH_SIZE);
    const result = await db(binding).delete(toolRuns).where(inArray(toolRuns.id, expired));
    const changes = result.meta.changes ?? 0;
    deleted += changes;
    if (changes < PURGE_BATCH_SIZE) return { deleted, cutoff, complete: true };
  }
  return { deleted, cutoff, complete: false };
}

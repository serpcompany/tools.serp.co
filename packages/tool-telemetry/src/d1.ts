import { and, count, desc, eq, gte, max } from "drizzle-orm";
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

const STATUS_BY_EVENT: Record<ToolRunEvent["event"], ToolRunStatus> = {
  tool_run_started: "started",
  tool_run_succeeded: "succeeded",
  tool_run_failed: "failed",
  tool_run_handed_off: "handed_off",
  tool_run_abandoned: "abandoned",
};

function toStatus(event: ToolRunEvent): ToolRunStatus {
  return STATUS_BY_EVENT[event.event];
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

  // A page can close after a run finished; never let that overwrite the
  // outcome. Abandoned runs don't change a tool's status.
  if (status === "abandoned") {
    await db(binding)
      .insert(toolRuns)
      .values(row)
      .onConflictDoUpdate({ target: toolRuns.id, set: fields, setWhere: eq(toolRuns.status, "started") });
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

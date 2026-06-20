import { median, summarizeToolRuns } from "./metrics.ts";
import type { ToolRunEvent, ToolRunRecord, ToolRunStatus } from "./types.ts";

export type D1Value = string | number | null;

export type D1ResultLike<T = unknown> = {
  results?: T[];
  success?: boolean;
  meta?: unknown;
};

export type D1PreparedStatementLike = {
  bind: (...values: D1Value[]) => D1PreparedStatementLike;
  run: <T = unknown>() => Promise<D1ResultLike<T>>;
  all: <T = Record<string, unknown>>() => Promise<D1ResultLike<T>>;
  first: <T = Record<string, unknown>>(columnName?: string) => Promise<T | null>;
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatementLike;
  batch?: <T = unknown>(
    statements: D1PreparedStatementLike[]
  ) => Promise<D1ResultLike<T>[]>;
};

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

export function isD1DatabaseLike(value: unknown): value is D1DatabaseLike {
  return !!value && typeof value === "object" && typeof (value as D1DatabaseLike).prepare === "function";
}

function toStatus(event: ToolRunEvent): ToolRunStatus {
  if (event.event === "tool_run_started") return "started";
  if (event.event === "tool_run_succeeded") return "succeeded";
  return "failed";
}

function toIsoText(value: string | Date): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toD1Integer(value?: number | null): number | null {
  const numberValue = toNumber(value);
  return numberValue === null ? null : Math.trunc(numberValue);
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

async function runSql(
  db: D1DatabaseLike,
  query: string,
  values: D1Value[] = []
) {
  await db.prepare(query).bind(...values).run();
}

async function allSql<T extends Record<string, unknown>>(
  db: D1DatabaseLike,
  query: string,
  values: D1Value[] = []
) {
  const result = await db.prepare(query).bind(...values).all<T>();
  return result.results ?? [];
}

function getString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNullableNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function d1RunRowToRecord(row: Record<string, unknown>): ToolRunRecord | null {
  const toolId = getString(row, "tool_id");
  const status = getString(row, "status") as ToolRunStatus | null;
  const startedAtText = getString(row, "started_at");
  if (!toolId || !status || !startedAtText) return null;

  const startedAt = new Date(startedAtText);
  if (Number.isNaN(startedAt.getTime())) return null;

  return {
    toolId,
    status,
    startedAt,
    durationMs: getNullableNumber(row, "duration_ms"),
    inputBytes: getNullableNumber(row, "input_bytes"),
    outputBytes: getNullableNumber(row, "output_bytes"),
    errorCode: getNullableString(row, "error_code"),
    metadata: parseMetadata(row.metadata),
  };
}

export async function updateD1ToolStatus(
  db: D1DatabaseLike,
  toolId: string,
  options: UpdateToolStatusOptions = {}
) {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - ONE_DAY_MS).toISOString();

  const rows = await allSql(db, `
    SELECT
      id,
      tool_id,
      status,
      started_at,
      duration_ms,
      input_bytes,
      output_bytes,
      error_code,
      metadata
    FROM tool_runs
    WHERE tool_id = ? AND started_at >= ?
    ORDER BY started_at DESC
  `, [toolId, since]);

  const normalizedRuns = rows
    .map(d1RunRowToRecord)
    .filter((run): run is ToolRunRecord => run !== null);

  const summary = summarizeToolRuns(normalizedRuns);
  const completed = normalizedRuns.filter(
    (run) => run.status === "succeeded" || run.status === "failed"
  );

  const reductionSamples = completed
    .filter((run) => run.status === "succeeded")
    .map((run) => {
      const input = toNumber(run.inputBytes);
      const output = toNumber(run.outputBytes);
      if (!input || !output) return null;
      return Math.round((1 - output / input) * 100);
    })
    .filter((value): value is number => value !== null);

  const medianReductionPct = median(reductionSamples);

  let status = "unknown";
  if (completed.length) {
    status = "live";
    if (summary.failureRate !== null && summary.failureRate >= 0.5) {
      status = "broken";
    } else if (summary.failureRate !== null && summary.failureRate >= 0.2) {
      status = "degraded";
    }
  }

  const lastRunAt = normalizedRuns[0]?.startedAt.toISOString() ?? null;
  const updatedAt = now.toISOString();

  await runSql(db, `
    INSERT INTO tool_status (
      tool_id,
      status,
      last_run_at,
      failure_rate_24h,
      median_duration_ms,
      median_reduction_pct,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tool_id) DO UPDATE SET
      status = excluded.status,
      last_run_at = excluded.last_run_at,
      failure_rate_24h = excluded.failure_rate_24h,
      median_duration_ms = excluded.median_duration_ms,
      median_reduction_pct = excluded.median_reduction_pct,
      updated_at = excluded.updated_at
  `, [
    toolId,
    status,
    lastRunAt,
    summary.failureRate,
    summary.medianDurationMs,
    medianReductionPct,
    updatedAt,
  ]);
}

export async function rebuildD1ToolStatuses(
  db: D1DatabaseLike,
  options: UpdateToolStatusOptions = {}
) {
  const rows = await allSql<{ toolId: string }>(db, `
    SELECT DISTINCT tool_id AS toolId
    FROM tool_runs
    ORDER BY tool_id
  `);

  for (const row of rows) {
    if (typeof row.toolId === "string") {
      await updateD1ToolStatus(db, row.toolId, options);
    }
  }

  return rows.length;
}

export async function recordToolRunInD1(
  db: D1DatabaseLike,
  payload: ToolRunEvent,
  options: UpdateToolStatusOptions = {}
) {
  const startedAt = toIsoText(payload.startedAt);
  if (!startedAt) {
    throw new Error("Invalid startedAt");
  }

  const status = toStatus(payload);
  const values: D1Value[] = [
    payload.runId,
    payload.toolId,
    status,
    startedAt,
    toD1Integer(payload.durationMs ?? null),
    toD1Integer(payload.inputBytes ?? null),
    toD1Integer(payload.outputBytes ?? null),
    payload.errorCode ?? null,
    stringifyMetadata(payload.metadata ?? null),
  ];

  if (status === "started") {
    await runSql(db, `
      INSERT OR IGNORE INTO tool_runs (
        id,
        tool_id,
        status,
        started_at,
        duration_ms,
        input_bytes,
        output_bytes,
        error_code,
        metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, values);
  } else {
    await runSql(db, `
      INSERT INTO tool_runs (
        id,
        tool_id,
        status,
        started_at,
        duration_ms,
        input_bytes,
        output_bytes,
        error_code,
        metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        tool_id = excluded.tool_id,
        status = excluded.status,
        started_at = excluded.started_at,
        duration_ms = excluded.duration_ms,
        input_bytes = excluded.input_bytes,
        output_bytes = excluded.output_bytes,
        error_code = excluded.error_code,
        metadata = excluded.metadata
    `, values);
  }

  await updateD1ToolStatus(db, payload.toolId, options);
}

export async function getD1ToolsDashboardData(
  db: D1DatabaseLike,
  options: UpdateToolStatusOptions = {}
): Promise<{ statusRows: D1ToolStatusRow[]; failureRows: D1FailureSummary[] }> {
  const statusRowsRaw = await allSql(db, `
    SELECT
      tool_id AS toolId,
      status,
      last_run_at AS lastRunAt,
      failure_rate_24h AS failureRate24h,
      median_duration_ms AS medianDurationMs,
      median_reduction_pct AS medianReductionPct,
      updated_at AS updatedAt
    FROM tool_status
    ORDER BY updated_at DESC
  `);

  const statusRows = statusRowsRaw.flatMap((row): D1ToolStatusRow[] => {
    const toolId = getString(row, "toolId");
    const status = getString(row, "status");
    const updatedAt = getString(row, "updatedAt");
    if (!toolId || !status || !updatedAt) return [];

    return [{
      toolId,
      status,
      lastRunAt: getNullableString(row, "lastRunAt"),
      failureRate24h: getNullableNumber(row, "failureRate24h"),
      medianDurationMs: getNullableNumber(row, "medianDurationMs"),
      medianReductionPct: getNullableNumber(row, "medianReductionPct"),
      updatedAt,
    }];
  });

  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - ONE_DAY_MS).toISOString();

  const failureCounts = await allSql(db, `
    SELECT
      tool_id AS toolId,
      error_code AS errorCode,
      count(*) AS count,
      max(started_at) AS lastSeen
    FROM tool_runs
    WHERE status = 'failed' AND started_at >= ?
    GROUP BY tool_id, error_code
    ORDER BY count DESC, lastSeen DESC
  `, [since]);

  const recentFailures = await allSql(db, `
    SELECT
      tool_id AS toolId,
      error_code AS errorCode,
      metadata,
      started_at AS startedAt
    FROM tool_runs
    WHERE status = 'failed' AND started_at >= ?
    ORDER BY started_at DESC
    LIMIT 200
  `, [since]);

  const sampleMetadataByKey = new Map<string, Record<string, unknown>>();
  for (const row of recentFailures) {
    const toolId = getString(row, "toolId");
    if (!toolId) continue;
    const errorCode = getNullableString(row, "errorCode");
    const metadata = parseMetadata(row.metadata);
    if (!metadata) continue;
    const key = `${toolId}::${errorCode ?? "unknown"}`;
    if (!sampleMetadataByKey.has(key)) {
      sampleMetadataByKey.set(key, metadata);
    }
  }

  const failureRows = failureCounts.flatMap((row): D1FailureSummary[] => {
    const toolId = getString(row, "toolId");
    if (!toolId) return [];
    const errorCode = getNullableString(row, "errorCode");
    const key = `${toolId}::${errorCode ?? "unknown"}`;

    return [{
      toolId,
      errorCode,
      count: getNullableNumber(row, "count") ?? 0,
      lastSeen: getNullableString(row, "lastSeen"),
      sampleMetadata: sampleMetadataByKey.get(key) ?? null,
    }];
  });

  return { statusRows, failureRows };
}

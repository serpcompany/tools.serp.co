import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");
const localWranglerBin = path.join(appRoot, "node_modules", ".bin", "wrangler");
const defaultDatabase = "SERP_TOOLS_DB";
const oneDayMs = 24 * 60 * 60 * 1000;

function usage() {
  return [
    "Usage: node scripts/import-tool-runs-to-d1.mjs [--local|--preview|--remote] [options]",
    "",
    "Options:",
    "  --database <name-or-binding>  D1 database name or binding. Defaults to SERP_TOOLS_DB.",
    "  --source <absolute-path>      Required protected JSON or CSV source outside the repository.",
    "  --chunk-size <number>         Rows per D1 execute statement. Defaults to 25.",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = {
    mode: "local",
    database: defaultDatabase,
    sourcePath: null,
    chunkSize: 25,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--local" || arg === "--preview" || arg === "--remote") {
      args.mode = arg.slice(2);
      continue;
    }
    if (arg === "--database") {
      args.database = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--source") {
      args.sourcePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--chunk-size") {
      args.chunkSize = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  if (!args.database) {
    throw new Error("--database must not be empty");
  }
  if (!args.sourcePath) {
    throw new Error("--source is required");
  }
  if (!path.isAbsolute(args.sourcePath) || isInsideRepository(args.sourcePath)) {
    throw new Error("--source must be an absolute path outside the repository");
  }
  if (!/\.(json|csv)$/i.test(args.sourcePath)) {
    throw new Error("--source must name a JSON or CSV file");
  }
  if (!Number.isInteger(args.chunkSize) || args.chunkSize < 1) {
    throw new Error("--chunk-size must be a positive integer");
  }

  return args;
}

function isInsideRepository(sourcePath) {
  const relativePath = path.relative(repoRoot, sourcePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveSourcePath(sourcePath) {
  let resolvedPath;
  try {
    resolvedPath = realpathSync(sourcePath);
  } catch {
    throw new Error("The explicit protected source is unavailable");
  }
  if (isInsideRepository(resolvedPath)) {
    throw new Error("--source must resolve outside the repository");
  }
  return resolvedPath;
}

export function parseJsonRows(source) {
  const parsed = JSON.parse(source);
  const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("JSON source must be an array or an object with a rows array");
  }
  return rows;
}

export function parseCsvRows(source) {
  const parsed = Papa.parse(source, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length) {
    const firstError = parsed.errors[0];
    throw new Error(firstError?.message ?? "CSV parse failed");
  }

  return parsed.data;
}

export function loadToolRunExport({ sourcePath } = {}) {
  if (!sourcePath) {
    throw new Error("--source is required");
  }
  const resolvedPath = resolveSourcePath(sourcePath);
  let source;
  try {
    source = readFileSync(resolvedPath, "utf8");
  } catch {
    throw new Error("The explicit protected source could not be read");
  }
  const rawRows = resolvedPath.toLowerCase().endsWith(".csv")
    ? parseCsvRows(source)
    : parseJsonRows(source);
  return normalizeRows(rawRows);
}

function readString(row, snakeKey, camelKey = snakeKey) {
  const value = row[snakeKey] ?? row[camelKey];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInteger(row, snakeKey, camelKey = snakeKey) {
  const value = row[snakeKey] ?? row[camelKey];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function readMetadata(row) {
  const value = row.metadata;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

function normalizeTimestamp(value, index) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Row ${index + 1} is missing started_at`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Row ${index + 1} has invalid started_at: ${value}`);
  }

  return parsed.toISOString();
}

export function normalizeRows(rows) {
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Row ${index + 1} is not an object`);
    }

    const id = readString(row, "id");
    const toolId = readString(row, "tool_id", "toolId");
    const status = readString(row, "status");
    const startedAtRaw = readString(row, "started_at", "startedAt");

    if (!id) throw new Error(`Row ${index + 1} is missing id`);
    if (!toolId) throw new Error(`Row ${index + 1} is missing tool_id`);
    if (status !== "started" && status !== "succeeded" && status !== "failed") {
      throw new Error(`Row ${index + 1} has invalid status: ${status ?? "null"}`);
    }

    const metadata = readMetadata(row);

    return {
      id,
      toolId,
      status,
      startedAt: normalizeTimestamp(startedAtRaw ?? "", index),
      durationMs: readInteger(row, "duration_ms", "durationMs"),
      inputBytes: readInteger(row, "input_bytes", "inputBytes"),
      outputBytes: readInteger(row, "output_bytes", "outputBytes"),
      errorCode: readString(row, "error_code", "errorCode"),
      metadataJson: metadata === null || metadata === undefined ? null : JSON.stringify(metadata),
      metadata,
    };
  });
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  return value === null || value === undefined ? "NULL" : String(value);
}

function sqlValues(row) {
  return [
    sqlString(row.id),
    sqlString(row.toolId),
    sqlString(row.status),
    sqlString(row.startedAt),
    sqlNumber(row.durationMs),
    sqlNumber(row.inputBytes),
    sqlNumber(row.outputBytes),
    sqlString(row.errorCode),
    sqlString(row.metadataJson),
  ].join(", ");
}

export function buildToolRunUpsertSql(rows) {
  if (!rows.length) return null;
  return `
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
    VALUES
      ${rows.map((row) => `(${sqlValues(row)})`).join(",\n      ")}
    ON CONFLICT(id) DO UPDATE SET
      tool_id = excluded.tool_id,
      status = excluded.status,
      started_at = excluded.started_at,
      duration_ms = excluded.duration_ms,
      input_bytes = excluded.input_bytes,
      output_bytes = excluded.output_bytes,
      error_code = excluded.error_code,
      metadata = excluded.metadata;
  `;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildStatusRows(rows, now = new Date()) {
  const since = now.getTime() - oneDayMs;
  const grouped = new Map();

  for (const row of rows) {
    const list = grouped.get(row.toolId) ?? [];
    list.push(row);
    grouped.set(row.toolId, list);
  }

  return Array.from(grouped.entries()).map(([toolId, toolRows]) => {
    const recentRuns = toolRows
      .filter((row) => new Date(row.startedAt).getTime() >= since)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const completed = recentRuns.filter(
      (row) => row.status === "succeeded" || row.status === "failed"
    );
    const failedRuns = completed.filter((row) => row.status === "failed").length;
    const durations = completed
      .map((row) => finiteNumber(row.durationMs))
      .filter((value) => value !== null);
    const reductions = completed
      .filter((row) => row.status === "succeeded")
      .map((row) => {
        const input = finiteNumber(row.inputBytes);
        const output = finiteNumber(row.outputBytes);
        if (!input || !output) return null;
        return Math.round((1 - output / input) * 100);
      })
      .filter((value) => value !== null);

    const failureRate = completed.length ? failedRuns / completed.length : null;
    let status = "unknown";
    if (completed.length) {
      status = "live";
      if (failureRate !== null && failureRate >= 0.5) {
        status = "broken";
      } else if (failureRate !== null && failureRate >= 0.2) {
        status = "degraded";
      }
    }

    return {
      toolId,
      status,
      lastRunAt: recentRuns[0]?.startedAt ?? null,
      failureRate24h: failureRate,
      medianDurationMs: median(durations),
      medianReductionPct: median(reductions),
      updatedAt: now.toISOString(),
    };
  });
}

function statusSqlValues(row) {
  return [
    sqlString(row.toolId),
    sqlString(row.status),
    sqlString(row.lastRunAt),
    sqlNumber(row.failureRate24h),
    sqlNumber(row.medianDurationMs),
    sqlNumber(row.medianReductionPct),
    sqlString(row.updatedAt),
  ].join(", ");
}

export function buildStatusUpsertSql(rows) {
  if (!rows.length) return null;
  return `
    INSERT INTO tool_status (
      tool_id,
      status,
      last_run_at,
      failure_rate_24h,
      median_duration_ms,
      median_reduction_pct,
      updated_at
    )
    VALUES
      ${rows.map((row) => `(${statusSqlValues(row)})`).join(",\n      ")}
    ON CONFLICT(tool_id) DO UPDATE SET
      status = excluded.status,
      last_run_at = excluded.last_run_at,
      failure_rate_24h = excluded.failure_rate_24h,
      median_duration_ms = excluded.median_duration_ms,
      median_reduction_pct = excluded.median_reduction_pct,
      updated_at = excluded.updated_at;
  `;
}

function chunkRows(rows, chunkSize) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
}

function modeFlag(mode) {
  if (mode === "local") return ["--local"];
  if (mode === "preview") return ["--remote", "--preview"];
  if (mode === "remote") return ["--remote"];
  throw new Error(`Unsupported mode: ${mode}`);
}

function executeD1({ database, mode, command, json = false }) {
  const wranglerCommand = existsSync(localWranglerBin) ? localWranglerBin : "wrangler";
  const args = ["d1", "execute", database, ...modeFlag(mode), "--command", command];
  if (json) args.push("--json");

  const result = spawnSync(wranglerCommand, args, {
    cwd: appRoot,
    encoding: "utf8",
    stdio: json ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0) {
    const errorDetail = result.error ? `\n${result.error.message}` : "";
    const signalDetail = result.signal ? `\nSignal: ${result.signal}` : "";
    const stderrDetail = json && result.stderr ? `\n${result.stderr}` : "";
    throw new Error(
      `wrangler d1 execute failed with status ${result.status}${errorDetail}${signalDetail}${stderrDetail}`
    );
  }

  return result.stdout ?? "";
}

export function extractCountFromD1Json(stdout) {
  const parsed = JSON.parse(stdout);
  const resultSet = Array.isArray(parsed) ? parsed[0] : parsed;
  const firstRow = resultSet?.results?.[0];
  const count = firstRow?.count ?? firstRow?.["COUNT(*)"];
  const numberValue = Number(count);
  if (!Number.isFinite(numberValue)) {
    throw new Error("Could not read count from D1 JSON output");
  }
  return numberValue;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const rows = loadToolRunExport(args);

  console.log(`Loaded ${rows.length} tool run rows from the explicit protected source.`);

  const runChunks = chunkRows(rows, args.chunkSize);
  runChunks.forEach((chunk, index) => {
    const sql = buildToolRunUpsertSql(chunk);
    if (!sql) return;
    console.log(`Importing tool_runs chunk ${index + 1}/${runChunks.length}`);
    executeD1({ database: args.database, mode: args.mode, command: sql });
  });

  const statusRows = buildStatusRows(rows);
  const statusChunks = chunkRows(statusRows, args.chunkSize);
  statusChunks.forEach((chunk, index) => {
    const sql = buildStatusUpsertSql(chunk);
    if (!sql) return;
    console.log(`Importing tool_status chunk ${index + 1}/${statusChunks.length}`);
    executeD1({ database: args.database, mode: args.mode, command: sql });
  });

  const countOutput = executeD1({
    database: args.database,
    mode: args.mode,
    command: "SELECT count(*) AS count FROM tool_runs;",
    json: true,
  });
  const importedCount = extractCountFromD1Json(countOutput);
  if (importedCount !== rows.length) {
    throw new Error(`Imported row count ${importedCount} did not match source row count ${rows.length}`);
  }

  console.log(`Imported ${importedCount} tool run rows into ${args.database} (${args.mode}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

import {
  PURGE_BATCH_SIZE,
  checkDeviceId,
  deviceRunsDeleteSql,
  expiredCountSql,
  purgeBatchSql,
  purgeCutoff,
} from "@serp-tools/tool-telemetry/purge";

const ENVIRONMENTS = new Set(["staging", "production"]);

// Arguments for scripts/purge-telemetry.mjs. `deviceId` is undefined unless
// --device-id was given, and then it must be a valid id: an empty value (say,
// an unset shell variable) must never fall through to the retention purge.
export function parsePurgeArgs(argv) {
  const args = { env: "", dryRun: false, deviceId: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env") args.env = argv[++index] ?? "";
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--device-id") args.deviceId = argv[++index] ?? "";
    else if (arg !== "--") throw new Error(`Unknown argument: ${arg}`);
  }
  if (!ENVIRONMENTS.has(args.env)) throw new Error("--env must be staging or production");
  if (args.deviceId !== undefined) {
    if (args.dryRun) throw new Error("--device-id deletes; it has no --dry-run");
    checkDeviceId(args.deviceId);
  }
  return args;
}

// Deletes tool runs older than the retention period in bounded batches.
// `execute(sql)` runs one statement and resolves to its rows.
export async function purgeExpiredToolRuns({
  execute,
  now = new Date(),
  batchSize = PURGE_BATCH_SIZE,
  maxBatches = 200,
  dryRun = false,
  log = () => {},
}) {
  const cutoff = purgeCutoff(now);
  if (dryRun) {
    const [row] = await execute(expiredCountSql(cutoff));
    return { cutoff, expired: Number(row?.expired ?? 0), deleted: 0, complete: true };
  }

  let deleted = 0;
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const rows = await execute(purgeBatchSql(cutoff, batchSize));
    deleted += rows.length;
    log(`batch ${batch}: deleted ${rows.length} (total ${deleted})`);
    if (rows.length < batchSize) return { cutoff, deleted, complete: true };
  }
  return { cutoff, deleted, complete: false };
}

// Deletes every run carrying one visitor's device id (a deletion request).
export async function deleteDeviceRuns({ execute, deviceId }) {
  const rows = await execute(deviceRunsDeleteSql(deviceId));
  return { deviceId, deleted: rows.length };
}

// Arguments for `wrangler d1 execute` against a deployed environment.
export function wranglerExecuteArgs({ wranglerBin, config, env, sql }) {
  return [
    wranglerBin,
    "d1",
    "execute",
    "SERP_TOOLS_DB",
    "--remote",
    "--config",
    config,
    "--env",
    env,
    "--command",
    sql,
    "--json",
  ];
}

// Rows from `wrangler d1 execute --json` output. Anything unexpected throws:
// treating it as "no rows" would make a broken purge report nothing to delete.
export function parseWranglerExecuteOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`wrangler d1 execute printed something other than JSON:\n${stdout.slice(0, 500)}`);
  }
  const [statement] = Array.isArray(parsed) ? parsed : [];
  if (!statement || statement.success !== true || !Array.isArray(statement.results)) {
    throw new Error(`Unexpected wrangler d1 execute output:\n${stdout.slice(0, 500)}`);
  }
  return statement.results;
}


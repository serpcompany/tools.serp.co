import {
  PURGE_BATCH_SIZE,
  expiredCountSql,
  purgeBatchSql,
  purgeCutoff,
} from "@serp-tools/tool-telemetry/purge";

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

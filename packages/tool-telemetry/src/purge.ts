// Retention for tool runs (docs/telemetry.md). The purge is run by hand with
// `pnpm -C apps/tools telemetry:purge`; these build its SQL so the command and
// the tests share one definition.

import { toolRuns } from "./schema.ts";

export const TOOL_RUN_RETENTION_DAYS = 90;
export const PURGE_BATCH_SIZE = 1000;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// Filtering on every status (from the schema, so a new one can't escape the
// purge) lets SQLite use the (status, started_at) index instead of scanning.
const STATUSES = toolRuns.status.enumValues.map((status) => `'${status}'`).join(", ");
const EXPIRED = (cutoff: string) => `status IN (${STATUSES}) AND started_at < '${cutoff}'`;

export function purgeCutoff(now: Date = new Date(), retentionDays = TOOL_RUN_RETENTION_DAYS) {
  return new Date(now.getTime() - retentionDays * ONE_DAY_MS).toISOString();
}

function checkCutoff(cutoff: string) {
  // The cutoff is inlined into SQL, so accept nothing but an ISO timestamp.
  if (!ISO_TIMESTAMP.test(cutoff)) throw new Error(`Invalid purge cutoff: ${cutoff}`);
}

// Deletes up to `batchSize` expired runs and returns their ids; run it until
// it returns fewer. RETURNING gives the count everywhere, including local
// `wrangler d1 execute`, which doesn't report `meta.changes`.
export function purgeBatchSql(cutoff: string, batchSize = PURGE_BATCH_SIZE) {
  checkCutoff(cutoff);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`Invalid purge batch size: ${batchSize}`);
  }
  return `DELETE FROM tool_runs WHERE id IN (SELECT id FROM tool_runs WHERE ${EXPIRED(cutoff)} LIMIT ${batchSize}) RETURNING id`;
}

export function expiredCountSql(cutoff: string) {
  checkCutoff(cutoff);
  return `SELECT count(*) AS expired FROM tool_runs WHERE ${EXPIRED(cutoff)}`;
}

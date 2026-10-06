import { purgeExpiredToolRuns, type D1DatabaseLike } from "@serp-tools/tool-telemetry/d1";

type PurgeEnv = { SERP_TOOLS_DB?: D1DatabaseLike | null };
type PurgeLog = Pick<Console, "log" | "error">;

// The daily cron in worker-entry.mjs. It logs the outcome to Workers Logs and
// rethrows, so a failed run shows as failed in Cron Events.
export async function runScheduledTelemetryPurge(env: PurgeEnv, log: PurgeLog = console) {
  try {
    if (!env.SERP_TOOLS_DB) throw new Error("SERP_TOOLS_DB binding is missing");
    const result = await purgeExpiredToolRuns(env.SERP_TOOLS_DB);
    log.log("telemetry purge", JSON.stringify(result));
    return result;
  } catch (error) {
    // The purge binds only the cutoff and fixed statuses, so the message
    // carries no visitor data.
    log.error("telemetry purge failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// The Worker entry: OpenNext's generated handler plus a daily cron that
// deletes tool runs older than the retention period (docs/telemetry.md).
// wrangler.jsonc points `main` here; `cf:build` generates .open-next/worker.js.
import handler from "./.open-next/worker.js";
import { runScheduledTelemetryPurge } from "./lib/telemetry-purge.ts";

export default {
  fetch: handler.fetch,
  async scheduled(_controller, env) {
    await runScheduledTelemetryPurge(env);
  },
};

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

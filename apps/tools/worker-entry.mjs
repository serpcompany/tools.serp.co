// The Worker entry: OpenNext's generated handler plus a daily cron that
// deletes tool runs older than the retention period (docs/telemetry.md).
// wrangler.jsonc points `main` here; `cf:build` generates .open-next/worker.js.
import { purgeExpiredToolRuns } from "@serp-tools/tool-telemetry/d1";

import handler from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      purgeExpiredToolRuns(env.SERP_TOOLS_DB).then(
        (result) => console.log("telemetry purge", JSON.stringify(result)),
        // Log the error class only; D1 messages can echo SQL and values.
        (error) => console.error("telemetry purge failed", error instanceof Error ? error.name : typeof error),
      ),
    );
  },
};

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";

import { withPageCacheFilter } from "./lib/page-cache-filter.ts";

export default defineCloudflareConfig({
  // Outermost, so neither R2 nor the regional cache stores a 404 or a page
  // rendered for a URL with a query string.
  incrementalCache: withPageCacheFilter(
    withRegionalCache(r2IncrementalCache, {
      mode: "long-lived",
      bypassTagCacheOnCacheHit: true,
    }),
  ),
});

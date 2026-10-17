import type { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";

// OpenNext's IncrementalCache, which @opennextjs/cloudflare doesn't export.
type IncrementalCache = Parameters<typeof withRegionalCache>[0];

// The incremental cache stores every page it renders, including a 404, and
// then serves that 404 from the cache. Any one-segment path reaches the
// [tool] route, so every URL a visitor or bot tries would write an R2 object
// and a regional cache entry. Wrapped by this, the cache stores no page whose
// render answered 404 (a [tool] slug that isn't an active Tool, an unknown
// category): it renders on each request, as before #315, and keeps its
// no-store header. URLs that match no route share one static not-found page,
// stored once per deploy like any static page. Other entries pass through.
export function withoutNotFoundPages(cache: IncrementalCache): IncrementalCache {
  return {
    // OpenNext picks the cache's storage (R2) by this name when it populates it.
    name: cache.name,
    get: (key, cacheType) => cache.get(key, cacheType),
    async set(key, value, cacheType) {
      if (isNotFoundPage(value)) return;
      await cache.set(key, value, cacheType);
    },
    delete: (key) => cache.delete(key),
  };
}

// A page or route entry records its status in `meta`; fetch and "use cache"
// entries have no `meta`.
function isNotFoundPage(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("meta" in value)) return false;
  const { meta } = value as { meta?: { status?: number } };
  return meta?.status === 404;
}

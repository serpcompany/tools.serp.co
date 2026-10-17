import type { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";

// OpenNext's IncrementalCache, which @opennextjs/cloudflare doesn't export.
type IncrementalCache = Parameters<typeof withRegionalCache>[0];

// The incremental cache stores each page it renders under the page's path and
// serves that copy to every later request for the path, until the next
// deploy. Wrapped by this, it doesn't store two kinds of render:
// - A page that answered 404 (a [tool] slug that isn't an active Tool, an
//   unknown category). Any one-segment path reaches [tool], so every URL a
//   visitor or bot tries would write an R2 object and a regional cache entry.
//   It renders on each request, as before #315, and keeps its no-store
//   header. URLs that match no route share one static not-found page, stored
//   once per deploy like any static page.
// - A page rendered for a URL with a query string, `?_rsc=` included. Next.js
//   writes the request's query into the page, so one visitor's `?email=` or
//   `gclid` would reach everyone. That request is answered as usual; the next
//   request for the bare path renders the page that is stored.
// Other entries, reads and deletes pass through.
export function withPageCacheFilter(cache: IncrementalCache): IncrementalCache {
  return {
    // OpenNext picks the cache's storage (R2) by this name when it populates it.
    name: cache.name,
    get: (key, cacheType) => cache.get(key, cacheType),
    async set(key, value, cacheType) {
      if (!isStorable(value)) return;
      await cache.set(key, value, cacheType);
    },
    delete: (key) => cache.delete(key),
  };
}

// A page or route entry records its status in `meta`; fetch and "use cache"
// entries have none. An App Router page ("app") also carries its RSC payload.
export function isStorable(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  const entry = value as { type?: unknown; meta?: { status?: unknown }; rsc?: unknown };
  if (entry.meta?.status === 404) return false;
  if (entry.type === "app") return renderedForBarePath(entry.rsc);
  return true;
}

// The payload's root row ("0:") records the URL it was rendered for, split at
// "/": "c":["","mts-to-mov",""] for /mts-to-mov/, and a last part such as
// "?utm_source=news" when the request had a query (Next.js
// prepareInitialCanonicalUrl). The page segment key carries the query too,
// `_rsc` aside: "__PAGE__?{...}". A payload this can't read isn't stored, so
// a change in Next.js can't let a visitor's query through
// (page-cache-filter.test.mjs checks the installed Next.js still writes both).
function renderedForBarePath(rsc: unknown): boolean {
  if (typeof rsc !== "string" || rsc.includes('"__PAGE__?')) return false;
  const parts = initialUrlParts(rsc);
  return parts !== undefined && !parts.some((part) => part.includes("?"));
}

function initialUrlParts(rsc: string): string[] | undefined {
  const row = /(?:^|\n)0:(\{[^\n]*)/.exec(rsc)?.[1];
  if (!row) return undefined;
  try {
    const { c } = JSON.parse(row) as { c?: unknown };
    return Array.isArray(c) && c.every((part) => typeof part === "string") ? c : undefined;
  } catch {
    return undefined;
  }
}

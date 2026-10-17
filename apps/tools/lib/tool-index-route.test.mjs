import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The route imports next/server and "@/" paths, which plain node can't load,
// so these checks read its source, as category-pages.test.mjs does.
const routeSource = readFileSync(
  new URL('../app/tool-index.json/route.ts', import.meta.url),
  'utf8',
);
const sitemapRouteSource = readFileSync(
  new URL('./sitemap-route.ts', import.meta.url),
  'utf8',
);

function headerValue(name) {
  return routeSource.match(new RegExp(`"${name}": "([^"]*)"`))?.[1];
}

test('/tool-index.json is never indexed', () => {
  assert.equal(headerValue('X-Robots-Tag'), 'noindex');
});

test('/tool-index.json is cached at the CDN like the sitemaps, and is JSON', () => {
  const sitemapCacheControl = sitemapRouteSource.match(/const CACHE_CONTROL = "([^"]+)"/)?.[1];
  assert.ok(sitemapCacheControl, 'sitemap-route.ts has no CACHE_CONTROL');
  assert.equal(headerValue('Cache-Control'), sitemapCacheControl);
  assert.equal(headerValue('Content-Type'), 'application/json; charset=utf-8');
  assert.match(routeSource, /export const dynamic = "force-dynamic";/);
});

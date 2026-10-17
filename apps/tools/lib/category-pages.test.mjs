import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const categoryPageUrl = new URL(
  '../app/category/[categoryName]/page.tsx',
  import.meta.url,
);
const categoryPagePath = fileURLToPath(categoryPageUrl);
const categoryPageSource = existsSync(categoryPagePath)
  ? readFileSync(categoryPageUrl, 'utf8')
  : '';
const sitemapSource = readFileSync(
  new URL('./sitemap.ts', import.meta.url),
  'utf8',
);

test('category sitemap paths are not left empty', () => {
  assert.doesNotMatch(sitemapSource, /const CATEGORY_PATHS: string\[] = \[\];/);
  assert.match(sitemapSource, /getCategoryPaths/);
});

test('category route preserves Cloudflare-compatible registry-backed pages', () => {
  assert.match(categoryPageSource, /generateStaticParams/);
  assert.doesNotMatch(categoryPageSource, /dynamicParams = false/);
  assert.match(categoryPageSource, /isToolOperation/);
  assert.match(categoryPageSource, /return notFound\(\)/);
  assert.match(categoryPageSource, /buildCategoryMetadata/);
});

const numberedPageSource = readFileSync(
  new URL('../app/category/[categoryName]/[page]/page.tsx', import.meta.url),
  'utf8',
);

test('numbered category pages redirect /1/, 404 past the last page, and are canonical to themselves', () => {
  assert.match(numberedPageSource, /generateStaticParams/);
  assert.doesNotMatch(numberedPageSource, /dynamicParams = false/);
  assert.match(numberedPageSource, /isToolOperation/);
  assert.match(numberedPageSource, /permanentRedirect\(categoryPageHref\(categoryName, 1\)\)/);
  assert.match(numberedPageSource, /return notFound\(\)/);
  assert.match(numberedPageSource, /buildCategoryMetadata/);
  assert.match(numberedPageSource, /canonical = categoryPageHref\(categoryName, listing\.page\)/);
});

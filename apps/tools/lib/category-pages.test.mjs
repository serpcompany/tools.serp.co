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

test('category route preserves Cloudflare-compatible catalog-backed pages', () => {
  assert.match(categoryPageSource, /generateStaticParams/);
  assert.doesNotMatch(categoryPageSource, /dynamicParams = false/);
  assert.match(categoryPageSource, /isToolOperation/);
  assert.match(categoryPageSource, /toolCatalog/);
  assert.match(categoryPageSource, /directoryCategories/);
  assert.match(categoryPageSource, /getDirectoryTools/);
  assert.doesNotMatch(categoryPageSource, /data\/tools\.json/);
  assert.doesNotMatch(categoryPageSource, /tool-directory/);
  assert.match(categoryPageSource, /return notFound\(\)/);
  assert.match(categoryPageSource, /buildCategoryMetadata/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getPagePaths } from './sitemap.ts';

const categoriesPageUrl = new URL(
  '../app/categories/page.tsx',
  import.meta.url,
);
const categoriesPagePath = fileURLToPath(categoriesPageUrl);
const categoriesPageSource = existsSync(categoriesPagePath)
  ? readFileSync(categoriesPageUrl, 'utf8')
  : '';

test('categories hub route consumes the Tool Catalog end to end', () => {
  assert.notEqual(categoriesPageSource, '');
  assert.match(categoriesPageSource, /toolCatalog/);
  assert.match(categoriesPageSource, /directoryCategories/);
  assert.match(categoriesPageSource, /buildCategoriesIndexMetadata/);
  assert.match(categoriesPageSource, /href=\{category\.href\}/);
  assert.doesNotMatch(categoriesPageSource, /data\/tools\.json/);
  assert.doesNotMatch(categoriesPageSource, /tool-directory/);
});

test('static sitemap paths include the categories hub page', () => {
  assert.ok(getPagePaths().includes('/categories/'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import toolsData from '../../../packages/app-core/src/data/tools.json' with { type: 'json' };
import { toolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import {
  buildToolDirectoryEntries,
  getToolDirectoryCategories,
} from './tool-directory.ts';

const categoriesPageUrl = new URL(
  '../app/categories/page.tsx',
  import.meta.url,
);
const categoriesPagePath = fileURLToPath(categoriesPageUrl);
const categoriesPageSource = existsSync(categoriesPagePath)
  ? readFileSync(categoriesPageUrl, 'utf8')
  : '';
const sitemapSource = readFileSync(
  new URL('./sitemap.ts', import.meta.url),
  'utf8',
);

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
  assert.match(sitemapSource, /"\/categories\/"/);
});

test('catalog migration preserves category names, counts, routes, and ordering', () => {
  const previousProjection = getToolDirectoryCategories(
    buildToolDirectoryEntries(toolsData),
  );

  assert.deepEqual(toolCatalog.directoryCategories, previousProjection);
  assert.doesNotThrow(() => JSON.stringify(toolCatalog.directoryCategories));
});

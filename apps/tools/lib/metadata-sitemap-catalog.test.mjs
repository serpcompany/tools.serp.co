import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { toolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import { buildCategoryMetadata, buildToolMetadata } from './metadata.ts';
import { getCategoryPaths, getToolPaths } from './sitemap.ts';

const metadataSource = readFileSync(
  new URL('./metadata.ts', import.meta.url),
  'utf8',
);
const sitemapSource = readFileSync(
  new URL('./sitemap.ts', import.meta.url),
  'utf8',
);

test('Tool metadata uses active catalog identity, content, and canonical routes', () => {
  assert.deepEqual(buildToolMetadata('aaf-to-mp4'), {});

  const specialized = buildToolMetadata('audio-to-text');
  assert.equal(specialized.title, 'Audio to Text | SERP Tools');
  assert.equal(
    specialized.description,
    'Transcribe an upload or direct public media file URL. YouTube links are not supported right now.',
  );
  assert.deepEqual(specialized.alternates, { canonical: '/audio-to-text/' });

  const fallback = buildToolMetadata('3g2-to-mp4');
  assert.equal(fallback.title, '3G2 to MP4 | SERP Tools');
  assert.equal(fallback.description, 'Convert 3G2 files to MP4 format');
  assert.deepEqual(fallback.alternates, { canonical: '/3g2-to-mp4/' });
});

test('category metadata uses catalog taxonomy and route rules', () => {
  const category = toolCatalog.directoryCategories.find(
    (candidate) => candidate.id === 'download',
  );
  assert.ok(category);

  const metadata = buildCategoryMetadata('download');

  assert.equal(metadata.title, `${category.title} | SERP Tools`);
  assert.equal(metadata.description, category.description);
  assert.deepEqual(metadata.alternates, { canonical: category.href });
  assert.deepEqual(buildCategoryMetadata('health'), {});
});

test('sitemap publication is the unique active Catalog route inventory', () => {
  const expectedToolPaths = toolCatalog.activeTools.map(
    (tool) => tool.canonicalRoute,
  );
  const expectedCategoryPaths = toolCatalog.directoryCategories.map(
    (category) => category.href,
  );

  assert.deepEqual(getToolPaths(), expectedToolPaths);
  assert.deepEqual(getCategoryPaths(), expectedCategoryPaths);
  assert.equal(new Set(getToolPaths()).size, getToolPaths().length);
  assert.equal(getToolPaths().includes('/aaf-to-mp4/'), false);
});

test('metadata and sitemap consumers do not parse the raw registry', () => {
  for (const source of [metadataSource, sitemapSource]) {
    assert.match(source, /toolCatalog/);
    assert.doesNotMatch(source, /data\/tools\.json/);
  }
  assert.doesNotMatch(metadataSource, /toolContent/);
  assert.doesNotMatch(metadataSource, /tool-directory/);
  assert.doesNotMatch(sitemapSource, /tool-directory/);
});

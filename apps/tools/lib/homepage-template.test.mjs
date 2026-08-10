import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import toolsData from '../../../packages/app-core/src/data/tools.json' with { type: 'json' };
import { toolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import { buildToolDirectoryEntries } from './tool-directory.ts';

const homepageSource = readFileSync(
  new URL('../app/page.tsx', import.meta.url),
  'utf8',
);
const homeDirectorySource = readFileSync(
  new URL('../components/HomeDirectory.tsx', import.meta.url),
  'utf8',
);

test('homepage does not render the request-a-tool CTA block', () => {
  assert.doesNotMatch(homepageSource, /Need a specific tool\?/);
  assert.doesNotMatch(
    homepageSource,
    /We&apos;re constantly adding new tools\. Let us know what you need!/,
  );
  assert.doesNotMatch(homepageSource, /Request a Tool/);
});

test('homepage discovery consumes normalized Tool Catalog projections', () => {
  assert.match(homepageSource, /toolCatalog/);
  assert.match(homepageSource, /directoryEntries/);
  assert.match(homepageSource, /directoryCategories/);
  assert.match(homepageSource, /HomeDirectory/);
  assert.doesNotMatch(homepageSource, /use client/);
  assert.doesNotMatch(homepageSource, /data\/tools\.json/);
  assert.doesNotMatch(homepageSource, /tool-directory/);
  assert.match(homeDirectorySource, /use client/);
  assert.doesNotMatch(homeDirectorySource, /toolCatalog/);
  assert.doesNotMatch(homeDirectorySource, /data\/tools\.json/);
});

test('homepage catalog migration preserves Tool membership, routes, and ordering', () => {
  assert.deepEqual(
    toolCatalog.directoryEntries,
    buildToolDirectoryEntries(toolsData),
  );
});

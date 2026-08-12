import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { operationalToolCatalog } from '../packages/app-core/src/lib/tool-catalog-adapter.mjs';
import {
  buildRouteManifest,
  getCategoryPaths,
  getOperationCounts,
} from '../apps/tools/scripts/lib/cloudflare-audit.mjs';
import { collectCatalogLanderLinks } from './lib/lander-link-catalog.mjs';

test('maintained script projections preserve Catalog routes, categories, and counts', () => {
  assert.deepEqual(getCategoryPaths(), operationalToolCatalog.categoryPaths);
  assert.deepEqual(
    getOperationCounts(),
    Object.fromEntries(
      Object.entries(operationalToolCatalog.operationCounts).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
  );
  const manifestTools = buildRouteManifest()
    .filter((route) => route.sources.includes('tool-registry'))
    .map((route) => route.metadata.toolId)
    .sort();
  assert.deepEqual(
    manifestTools,
    operationalToolCatalog.activeTools.map((tool) => tool.id).sort(),
  );
});

test('outbound-link projection retains Catalog identity and exact content URLs', () => {
  const links = collectCatalogLanderLinks(operationalToolCatalog.tools);
  const thisVid = links.filter((link) => link.toolId === 'download-thisvid-videos');
  assert.ok(thisVid.length > 0);
  assert.ok(thisVid.every((link) => link.route === '/download-thisvid-videos'));
  assert.ok(thisVid.every((link) => /^https?:\/\//.test(link.url)));
});

test('maintained Tool consumers use the Catalog or its approved adapter', () => {
  const catalogConsumers = [
    'apps/tools/app/internal/tools/page.tsx',
    'scripts/run-browser-check.mjs',
    'scripts/validate-lander-outbound-links.mjs',
    'apps/tools/scripts/lib/cloudflare-audit.mjs',
  ];
  for (const file of catalogConsumers) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /packages\/app-core\/src\/data\/tools\.json|@serp-tools\/app-core\/data\/tools\.json/);
    assert.match(
      source,
      /toolCatalog|operationalToolCatalog|joinToolEvidence|buildToolFactoryReadModel/,
    );
  }
  assert.match(
    readFileSync('apps/tools/lib/tool-factory-read-model.ts', 'utf8'),
    /toolCatalog/,
  );
  assert.match(
    readFileSync('scripts/lib/downloader-registry-sync.mjs', 'utf8'),
    /createOperationalToolCatalog/,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findToolCatalogBoundaryViolations,
  verifyRepositoryToolCatalogBoundary,
} from './verify-tool-catalog-boundary.mjs';

test('boundary failure names public interfaces and migration guidance', () => {
  const violations = findToolCatalogBoundaryViolations([
    {
      path: 'apps/tools/lib/raw-reader.ts',
      source:
        "import tools from '../../../packages/app-core/src/data/tools.json';",
    },
    {
      path: 'apps/tools/lib/legacy-reader.ts',
      source: "import { build } from './tool-directory';",
    },
    {
      path: 'apps/tools/lib/raw-file-reader.ts',
      source:
        "readFileSync('packages/app-core/src/data/tools.json', 'utf8');",
    },
    {
      path: 'apps/tools/lib/publication-reader.ts',
      source: `
        import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';
        toolCatalog.tools.filter(({ isActive }) => isActive);
      `,
    },
    {
      path: 'apps/tools/lib/advisory-planner-reader.test.mjs',
      source:
        "readFileSync('../../../docs/evidence/tool-planning/tools_planner.csv', 'utf8');",
    },
    {
      path: 'apps/tools/lib/segmented-advisory-planner-reader.test.mjs',
      source: `
        readFileSync(
          path.join(root, 'docs', 'evidence', 'tool-planning', 'tools_planner.csv'),
          'utf8',
        );
      `,
    },
    {
      path: 'apps/tools/lib/renamed-catalog-reader.ts',
      source: `
        import { toolCatalog as catalog } from '@serp-tools/app-core/lib/tool-catalog';
        catalog.tools.filter(({ isActive }) => isActive);
      `,
    },
    {
      path: 'apps/tools/lib/catalog-object-alias-reader.ts',
      source: `
        import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';
        const catalog = toolCatalog;
        catalog.tools.filter((tool) => tool.isActive);
      `,
    },
    {
      path: 'apps/tools/lib/destructured-tools-reader.ts',
      source: `
        import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';
        const { tools: entries } = toolCatalog;
        entries.filter((tool) => tool.isActive);
      `,
    },
    {
      path: 'apps/tools/lib/namespace-catalog-reader.ts',
      source: `
        import * as catalogApi from '@serp-tools/app-core/lib/tool-catalog';
        catalogApi.toolCatalog.tools.filter(({ isActive }) => isActive);
      `,
    },
    {
      path: 'apps/tools/lib/unrelated-reader.ts',
      source: 'users.filter((user) => user.isActive);',
    },
    {
      path: 'scripts/sync-downloader-landers-from-registry.mjs',
      source:
        "readFileSync('packages/app-core/src/data/tools.json', 'utf8');",
    },
  ]);

  const report = violations.join('\n');
  assert.equal(violations.length, 10);
  assert.match(report, /@serp-tools\/app-core\/lib\/tool-catalog/);
  assert.match(report, /tool-catalog-adapter/);
  assert.match(report, /raw-reader\.ts/);
  assert.match(report, /retired Tool catalog compatibility module/);
  assert.match(report, /raw-file-reader\.ts/);
  assert.match(report, /publication-reader\.ts/);
  assert.match(report, /renamed-catalog-reader\.ts/);
  assert.match(report, /catalog-object-alias-reader\.ts/);
  assert.match(report, /destructured-tools-reader\.ts/);
  assert.match(report, /namespace-catalog-reader\.ts/);
  assert.match(report, /advisory-planner-reader\.test\.mjs/);
  assert.match(report, /segmented-advisory-planner-reader\.test\.mjs/);
  assert.match(report, /advisory CSV evidence is not an operational input/);
  assert.doesNotMatch(report, /unrelated-reader\.ts/);
  assert.doesNotMatch(report, /sync-downloader-landers/);
});

test('maintained repository sources respect the Tool Catalog boundary', () => {
  assert.deepEqual(verifyRepositoryToolCatalogBoundary(), []);
});

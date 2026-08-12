import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createToolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import {
  describeDashboardLoadError,
  joinToolEvidence,
} from './internal-tools-dashboard.ts';

const catalog = createToolCatalog([
  {
    id: 'alpha',
    name: 'Alpha Tool',
    description: 'Alpha description',
    operation: 'convert',
    route: '/alpha',
    isActive: true,
  },
]);

test('internal evidence joins preserve Catalog intent separately from observations', () => {
  const knownEvidence = { toolId: 'alpha', status: 'failed', count: 2 };
  const unknownEvidence = { toolId: 'missing', status: 'unknown', count: 1 };
  const joined = joinToolEvidence([knownEvidence, unknownEvidence], catalog);

  assert.deepEqual(joined[0], {
    tool: {
      id: 'alpha',
      name: 'Alpha Tool',
      route: '/alpha',
      isActive: true,
    },
    evidence: knownEvidence,
  });
  assert.deepEqual(joined[1], {
    tool: null,
    evidence: unknownEvidence,
  });
  assert.equal(joined[0].evidence, knownEvidence);
});

test('internal Tool page consumes its Catalog-backed read model instead of raw registry data', () => {
  const pageSource = readFileSync(
    'apps/tools/app/internal/tools/page.tsx',
    'utf8',
  );
  const modelSource = readFileSync(
    'apps/tools/lib/tool-factory-read-model.ts',
    'utf8',
  );
  assert.match(pageSource, /buildToolFactoryReadModel/);
  assert.match(pageSource, /authorizeToolFactoryRequest/);
  assert.match(pageSource, /cf-access-jwt-assertion/);
  assert.match(modelSource, /toolCatalog/);
  assert.doesNotMatch(
    `${pageSource}\n${modelSource}`,
    /data\/tools\.json|toolsData|toolMap/,
  );
});

test('internal Tool dashboard controls uninitialized D1 errors without exposing database details', () => {
  const rawError = 'D1_ERROR: no such table: tool_status: SQLITE_ERROR';
  const state = describeDashboardLoadError(new Error(rawError));

  assert.deepEqual(state, {
    title: 'Telemetry database is not initialized',
    message:
      'Apply the configured D1 migrations, then refresh this page. For local development, run pnpm migrate:d1:local.',
  });
  assert.doesNotMatch(
    `${state.title} ${state.message}`,
    /D1_ERROR|SQLITE|tool_status/,
  );
});

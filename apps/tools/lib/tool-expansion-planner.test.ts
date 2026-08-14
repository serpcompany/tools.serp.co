import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolExpansionPlan } from './tool-expansion-planner.ts';
import { buildToolFactoryReadModel } from './tool-factory-read-model.ts';

test('expansion plan groups every explicitly unsupported Tool exactly once from source-owned facts', () => {
  const model = buildToolFactoryReadModel();
  const plan = buildToolExpansionPlan(model.rows);
  const unsupportedToolIds = model.rows
    .filter((row) => row.support.disposition === 'unsupported')
    .map((row) => row.toolId)
    .sort();

  assert.equal(plan.unsupportedToolCount, 2_365);
  assert.deepEqual(
    plan.groups.flatMap((group) => group.toolIds).sort(),
    unsupportedToolIds,
  );
  assert.equal(
    new Set(plan.groups.flatMap((group) => group.toolIds)).size,
    unsupportedToolIds.length,
  );

  const first = plan.groups[0];
  assert.ok(first);
  assert.equal(first.rank, 1);
  assert.equal(first.operationFamily, 'wave:heif-browser-libheif');
  assert.equal(first.browserFeasibility, 'existing-browser-code');
  assert.equal(first.unlockCount, 4);
  assert.deepEqual(first.toolIds, [
    'heif-to-jpg',
    'heif-to-pdf',
    'heif-to-png',
    'heif-to-webp',
  ]);
  assert.deepEqual(
    first.candidateEngines.map((engine) => engine.id),
    ['browser-raster-worker'],
  );
  assert.deepEqual(first.executionLocations, ['browser']);
  assert.equal(first.supportMeaning, 'planning-candidates-only');
});

test('candidate ranking exposes facts, assumptions, and every required review instead of a magic support score', () => {
  const plan = buildToolExpansionPlan(buildToolFactoryReadModel().rows);
  const first = plan.groups[0];
  assert.ok(first);

  assert.equal(
    plan.ranking.method,
    'Browser feasibility, test readiness, decision cost, exact Tool count, then stable family ID.',
  );
  assert.deepEqual(plan.ranking.assumptions, [
    'Existing browser code with distinct fixtures and semantic validators is reviewed before speculative bulk mappings.',
    'Candidate categories and ranking do not establish feasibility or support.',
  ]);
  assert.equal(
    plan.supportNotice,
    'Candidate library, engine mapping, or installed-package presence is planning evidence only and never verified support.',
  );
  assert.equal('score' in first, false);
  assert.deepEqual(
    first.blockers.map((blocker) => [blocker.kind, blocker.status]),
    [
      ['adapter', 'missing'],
      ['browser-runtime-fit', 'needs-review'],
      ['fixture', 'needs-review'],
      ['semantic-validator', 'missing'],
      ['limits', 'needs-review'],
      ['licensing', 'needs-review'],
      ['maintenance-review', 'needs-review'],
    ],
  );
  assert.match(first.facts[0]?.statement ?? '', /4 exact Tool IDs/);
  assert.equal(first.facts[0]?.source, 'Tool Factory support read model');
  assert.ok(first.assumptions.every((assumption) => assumption.length > 0));
  assert.ok(
    first.candidateEngines.every(
      (engine) =>
        engine.source === 'maintained execution provenance' &&
        engine.verifiedSupport === false,
    ),
  );
});

test('portfolio groups expose client-first decision categories without treating broad adaptive mappings as proof', () => {
  const plan = buildToolExpansionPlan(buildToolFactoryReadModel().rows);
  const classifications = new Set(
    plan.groups.map((group) => group.browserFeasibility),
  );
  assert.deepEqual([...classifications].sort(), [
    'catalog-review',
    'existing-browser-code',
    'new-browser-wasm-library',
    'server-alternative-research',
    'unresolved',
  ]);

  const adaptive = plan.groups.find(
    (group) => group.operationFamily === 'generic-convert:adaptive-video',
  );
  assert.ok(adaptive);
  assert.equal(adaptive.browserFeasibility, 'unresolved');
  assert.equal(adaptive.unlockCount, 1_501);
  assert.ok(
    !adaptive.toolIds.some((toolId) =>
      ['webm-to-m4a', 'webm-to-mp3', 'webm-to-mp4'].includes(toolId),
    ),
  );

  assert.equal(
    plan.groups.reduce((sum, group) => sum + group.unlockCount, 0),
    2_365,
  );
});

test('planner rejects duplicate unsupported Tool identities and returns immutable planning evidence', () => {
  const unsupported = buildToolFactoryReadModel().rows.find(
    (row) => row.support.disposition === 'unsupported',
  );
  assert.ok(unsupported);
  assert.throws(
    () => buildToolExpansionPlan([unsupported, unsupported]),
    /duplicate unsupported Tool IDs/,
  );

  const plan = buildToolExpansionPlan(buildToolFactoryReadModel().rows);
  const first = plan.groups[0];
  assert.ok(first);
  assert.throws(() => {
    (first.toolIds as string[]).push('invented-tool');
  }, TypeError);
  assert.throws(() => {
    (first.candidateEngines as unknown[]).push({});
  }, TypeError);
});

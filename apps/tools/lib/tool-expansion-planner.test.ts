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

  assert.equal(plan.unsupportedToolCount, 2_373);
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
  assert.equal(first.operationFamily, 'generic-convert:adaptive-video');
  assert.equal(first.unlockCount, 1_505);
  assert.deepEqual(
    first.candidateEngines.map((engine) => engine.id),
    [
      'adaptive-media-conversion',
      'browser-ffmpeg-wasm',
      'server-video-convert',
    ],
  );
  assert.deepEqual(first.executionLocations, [
    'browser',
    'browser-with-repository-server-support',
    'repository-server',
  ]);
  assert.equal(first.supportMeaning, 'planning-candidates-only');
});

test('candidate ranking exposes facts, assumptions, and every required review instead of a magic support score', () => {
  const plan = buildToolExpansionPlan(buildToolFactoryReadModel().rows);
  const first = plan.groups[0];
  assert.ok(first);

  assert.equal(
    plan.ranking.method,
    'Exact unsupported Tool count descending, then operation family name.',
  );
  assert.deepEqual(plan.ranking.assumptions, [
    'A reviewed family adapter may reduce repeated work across its exact member Tools.',
    'Larger exact groups are evaluated first; this ordering does not establish feasibility or support.',
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
  assert.match(first.facts[0]?.statement ?? '', /1,505 exact Tool IDs/);
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

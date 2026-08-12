import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolClientFirstPlan } from './tool-client-first-plan.ts';
import { buildToolFactoryReadModel } from './tool-factory-read-model.ts';

test('unsupported Tools keep candidate engines separate from what runs today', () => {
  const row = buildToolFactoryReadModel().getByToolId('3g2-to-mp4');
  assert.ok(row);

  const tool = buildToolClientFirstPlan([row]).getByToolId(row.toolId);
  assert.ok(tool);
  assert.deepEqual(tool.currentExecution, {
    state: 'unsupported',
    engineIds: [],
    explanation:
      'This Tool fails closed today; no processor engine is registered for this exact operation.',
  });
  assert.equal(tool.preferredTarget, 'undecided');
  assert.equal(tool.serverDependency, 'unknown');
  assert.equal(tool.browserFeasibility, 'unresolved');
  assert.ok(tool.candidateEngines.length > 0);
  assert.ok(
    tool.candidateEngines.every((candidate) => !candidate.verifiedSupport),
  );
  assert.deepEqual(
    [
      ...new Set(
        tool.candidateEngines.map((candidate) => candidate.executionProfile),
      ),
    ].sort(),
    ['client-only', 'server-assisted', 'server-executed'],
  );
});

test('registered browser and hybrid Tools describe their actual execution clearly', () => {
  const model = buildToolFactoryReadModel();
  const rows = ['bmp-to-png', 'audio-to-text'].map((toolId) => {
    const row = model.getByToolId(toolId);
    assert.ok(row);
    return row;
  });
  const plan = buildToolClientFirstPlan(rows);

  assert.deepEqual(plan.getByToolId('bmp-to-png')?.currentExecution, {
    state: 'browser',
    engineIds: ['browser-raster-worker'],
    explanation: 'The registered processor executes in the browser.',
  });
  assert.equal(
    plan.getByToolId('bmp-to-png')?.preferredTarget,
    'browser-first',
  );
  assert.equal(plan.getByToolId('bmp-to-png')?.serverDependency, 'none');

  assert.equal(
    plan.getByToolId('audio-to-text')?.currentExecution.state,
    'hybrid',
  );
  assert.equal(
    plan.getByToolId('audio-to-text')?.preferredTarget,
    'browser-first',
  );
  assert.equal(
    plan.getByToolId('audio-to-text')?.serverDependency,
    'optional-fallback',
  );
});

test('current server execution does not claim a browser alternative is impossible', () => {
  const model = buildToolFactoryReadModel();
  const row = model.getByToolId('download-123movies-videos');
  assert.ok(row);
  const tool = buildToolClientFirstPlan([row]).getByToolId(row.toolId);
  assert.ok(tool);

  assert.equal(tool.currentExecution.state, 'server');
  assert.equal(tool.preferredTarget, 'undecided');
  assert.equal(tool.serverDependency, 'required');
  assert.equal(tool.browserFeasibility, 'unresolved');
  assert.match(tool.currentExecution.explanation, /server today/);
});

test('client-first planning output is immutable and has exact membership', () => {
  const model = buildToolFactoryReadModel();
  const plan = buildToolClientFirstPlan(model.rows);

  assert.equal(plan.rows.length, 2_807);
  assert.equal(new Set(plan.rows.map((row) => row.toolId)).size, 2_807);
  assert.throws(() => {
    (plan.rows as unknown[]).push({});
  }, TypeError);
});

test('unsupported portfolio receives conservative browser decision categories', () => {
  const plan = buildToolClientFirstPlan(buildToolFactoryReadModel().rows);

  assert.deepEqual(
    {
      webm: plan.getByToolId('webm-to-mp3')?.browserFeasibility,
      raster: plan.getByToolId('avif-to-png')?.browserFeasibility,
      same: plan.getByToolId('avif-to-avif')?.browserFeasibility,
      server: plan.getByToolId('cr3-to-png')?.browserFeasibility,
      adaptive: plan.getByToolId('3g2-to-mp4')?.browserFeasibility,
    },
    {
      webm: 'existing-browser-path',
      raster: 'new-browser-library',
      same: 'catalog-review',
      server: 'unresolved',
      adaptive: 'unresolved',
    },
  );
  assert.equal(
    plan.getByToolId('webm-to-mp3')?.preferredTarget,
    'browser-first',
  );
  assert.equal(plan.getByToolId('webm-to-mp3')?.serverDependency, 'unknown');
});

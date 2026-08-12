import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolFactoryReadModel } from './tool-factory-read-model.ts';

test('Tool Factory read model accounts for every active Tool exactly once', () => {
  const model = buildToolFactoryReadModel();

  assert.equal(model.rows.length, 2_807);
  assert.equal(new Set(model.rows.map((row) => row.toolId)).size, 2_807);
  assert.deepEqual(model.counts, {
    supported: 431,
    unsupported: 2_373,
    unwired: 0,
    unknown: 3,
  });
});

test('supported Tool keeps implementation, verification, and runtime facts separate', () => {
  const row = buildToolFactoryReadModel().getByToolId('png-to-webp');

  assert.ok(row);
  assert.equal(row.support.disposition, 'supported');
  assert.equal(row.support.adapterId, 'generic-conversion');
  assert.deepEqual(row.implementation.engines, [
    {
      id: 'browser-raster-worker',
      identity:
        'libheif, WebCodecs ImageDecoder, createImageBitmap, Canvas 2D, and pdf-lib',
      implementationClass: 'hybrid',
      processingLocation: 'browser',
      executionProfile: 'client-only',
      owner: 'apps/tools/lib/convert/workerClient.ts',
    },
  ]);
  assert.equal(
    row.controlledVerification.classification,
    'registered-with-semantic-policy',
  );
  assert.equal(row.controlledVerification.retainedExecutionResult, false);
  assert.equal(row.runtimeRequirement.classification, 'declared-client-only');
  assert.equal(row.runtimeObservation.classification, 'not-loaded');
  assert.deepEqual(row.attention.codes, []);
});

test('unsupported Tool names its contract and runtime proof gaps without becoming broken', () => {
  const row = buildToolFactoryReadModel().getByToolId('3g2-to-mp4');

  assert.ok(row);
  assert.equal(row.support.disposition, 'unsupported');
  assert.equal(row.support.adapterId, null);
  assert.equal(
    row.controlledVerification.classification,
    'explicit-fail-closed-contract',
  );
  assert.deepEqual(row.runtimeRequirement.executionProfiles, [
    'client-only',
    'server-assisted',
    'server-executed',
  ]);
  assert.deepEqual(row.attention.codes, [
    'no-registered-processor',
    'exact-contract-unsupported',
    'runtime-proof-needed',
  ]);
  assert.equal(row.runtimeObservation.classification, 'not-loaded');
});

test('unknown Tool remains unknown and names the evidence needed to resolve it', () => {
  const row = buildToolFactoryReadModel().getByToolId('audio-editor');

  assert.ok(row);
  assert.equal(row.support.disposition, 'unknown');
  assert.equal(row.implementation.provenance, 'unknown');
  assert.equal(
    row.implementation.sourceNeeded,
    'Trace the active renderer to the function that performs its core operation.',
  );
  assert.deepEqual(row.attention.codes, ['implementation-unknown']);
  assert.throws(() => {
    (row.implementation.engines as unknown[]).push({});
  }, TypeError);
});

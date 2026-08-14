import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolFactoryReadModel } from './tool-factory-read-model.ts';

test('Tool Factory read model accounts for every active Tool exactly once', () => {
  const model = buildToolFactoryReadModel();

  assert.equal(model.rows.length, 2_807);
  assert.equal(new Set(model.rows.map((row) => row.toolId)).size, 2_807);
  assert.deepEqual(model.counts, {
    supported: 437,
    unsupported: 2_367,
    unwired: 0,
    unknown: 3,
  });
  assert.equal(
    model.rows.reduce((total, row) => total + row.journeys.length, 0),
    3_115,
  );
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
  assert.deepEqual(
    row.verificationEvidence.map((evidence) => evidence.journeyId),
    ['png-to-webp:upload'],
  );
  assert.ok(row.verificationEvidence[0]);
  assert.deepEqual(row.verificationEvidence[0]?.missingChecks, []);
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
  assert.deepEqual(
    row.verificationEvidence.map((evidence) => evidence.state),
    ['no-evidence'],
  );
});

test('registered family policy projects refreshed retained evidence as verified', () => {
  const row = buildToolFactoryReadModel().getByToolId('bmp-to-png');

  assert.ok(row);
  assert.equal(
    row.controlledVerification.classification,
    'registered-with-semantic-policy',
  );
  assert.deepEqual(
    row.verificationEvidence.map((evidence) => evidence.journeyId),
    ['bmp-to-png:upload'],
  );
  assert.equal(row.verificationEvidence[0]?.state, 'verified');
  assert.deepEqual(row.verificationEvidence[0]?.missingChecks, []);
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

test('Tool and exact family GitHub work remain a separate read-model dimension', () => {
  const row = buildToolFactoryReadModel().getByToolId('audio-to-text');

  assert.ok(row);
  assert.deepEqual(
    row.githubWork.tool.links.map((link) => [link.number, link.stateLabel]),
    [
      [96, 'Open pull request'],
      [97, 'Closed issue'],
    ],
  );
  assert.deepEqual(
    row.githubWork.family.links.map((link) => [link.number, link.stateLabel]),
    [[85, 'Open pull request']],
  );
  assert.equal(row.support.disposition, 'supported');
  assert.equal(row.runtimeObservation.classification, 'not-loaded');
  assert.deepEqual(
    row.journeys.map((journey) => [
      journey.id,
      journey.input.kind,
      journey.requiredEnvironment,
    ]),
    [
      ['audio-to-text:upload', 'file', 'browser'],
      ['audio-to-text:direct-url', 'direct-url', 'preview'],
      ['audio-to-text:extractor-url', 'extractor-url', 'preview'],
    ],
  );
});

test('missing exact Tool and family work stays empty instead of being guessed from titles', () => {
  const row = buildToolFactoryReadModel().getByToolId('png-to-webp');

  assert.ok(row);
  assert.equal(row.githubWork.tool.coverage, 'complete');
  assert.deepEqual(row.githubWork.tool.links, []);
  assert.equal(row.githubWork.family.coverage, 'not-ingested');
  assert.deepEqual(row.githubWork.family.links, []);
  assert.throws(() => {
    (row.githubWork.tool.links as unknown[]).push({});
  }, TypeError);
});

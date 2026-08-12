import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeToolAcceptance } from './tool-acceptance-classification.mjs';

test('acceptance classification is mutually exclusive and keeps explicit unsupported separate from unwired', () => {
  const summary = summarizeToolAcceptance([
    { id: 'wired', availabilityKind: 'wired', renderer: 'generic' },
    {
      id: 'generic-unsupported',
      availabilityKind: 'unwired',
      renderer: 'generic',
      genericContractState: 'unsupported',
    },
    {
      id: 'table-unsupported',
      availabilityKind: 'unwired',
      renderer: 'table',
      tablePolicyKind: 'unsupported',
    },
    { id: 'known-gap', availabilityKind: 'unwired', renderer: 'placeholder' },
    { id: 'unknown', availabilityKind: 'unknown', renderer: 'placeholder' },
  ]);

  assert.deepEqual(summary.counts, {
    supported: 1,
    unsupported: 2,
    unwired: 1,
    unknown: 1,
  });
  assert.deepEqual(summary.toolIds.unsupported, [
    'generic-unsupported',
    'table-unsupported',
  ]);
  assert.equal(
    Object.values(summary.toolIds).flat().length,
    new Set(Object.values(summary.toolIds).flat()).size,
  );
});

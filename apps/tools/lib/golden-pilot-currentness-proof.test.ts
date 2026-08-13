import assert from 'node:assert/strict';
import test from 'node:test';

import { proveGoldenPilotEvidenceCurrentness } from './golden-pilot-currentness-proof.ts';

test('Golden pilot mechanically proves current to stale to current evidence and fail-closed outcomes', () => {
  const proof = proveGoldenPilotEvidenceCurrentness();

  assert.equal(proof.journeyId, 'png-to-webp:upload');
  assert.equal(proof.changedInput, 'fixture-content');
  assert.deepEqual(proof.transitions, [
    { step: 'current-before-change', state: 'verified' },
    { step: 'fixture-changed', state: 'stale' },
    { step: 'restored-and-rerun', state: 'verified' },
  ]);
  assert.deepEqual(proof.failClosed, {
    warned: 'warned',
    skipped: 'skipped',
    missingCheck: 'incomplete',
    semanticFailure: 'failed',
  });
  assert.throws(
    () =>
      (
        proof.transitions as unknown as Array<{
          step: string;
          state: string;
        }>
      ).pop(),
    TypeError,
  );
});

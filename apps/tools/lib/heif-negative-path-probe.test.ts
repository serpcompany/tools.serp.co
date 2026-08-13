import assert from 'node:assert/strict';
import test from 'node:test';

import { runHeifNegativePathProbe } from './heif-negative-path-probe.ts';

test('HEIF family fails closed for adversarial input, output, and cancellation', async () => {
  const proof = await runHeifNegativePathProbe();
  assert.deepEqual(proof.checks, [
    'malformed-input',
    'spoofed-input',
    'wrong-format-output',
    'no-delivery-on-failure',
    'cancellation-lifecycle',
  ]);
  assert.equal(proof.observed.deliveries, 0);
  assert.equal(proof.observed.cleanupCalls, 1);
});

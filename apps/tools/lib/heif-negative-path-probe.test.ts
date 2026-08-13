import assert from 'node:assert/strict';
import test from 'node:test';

import { runHeifNegativePathProbe } from './heif-negative-path-probe.ts';

test('HEIF family fails closed for adversarial input, output, and cancellation', async () => {
  const proof = await runHeifNegativePathProbe();
  assert.deepEqual(
    proof.journeys.map((journey) => journey.journeyId),
    [
      'heif-to-jpg:upload',
      'heif-to-pdf:upload',
      'heif-to-png:upload',
      'heif-to-webp:upload',
    ],
  );
  for (const journey of proof.journeys) {
    assert.deepEqual(journey.checks, [
      'malformed-input',
      'spoofed-input',
      'wrong-format-output',
      'no-delivery-on-failure',
      'cancellation-lifecycle',
    ]);
    assert.deepEqual(journey.observed.cancellationPhases, ['encode']);
    assert.equal(journey.observed.cancelledRuns, 1);
    assert.equal(journey.observed.deliveries, 0);
    assert.equal(journey.observed.cleanupCalls, 1);
  }
});

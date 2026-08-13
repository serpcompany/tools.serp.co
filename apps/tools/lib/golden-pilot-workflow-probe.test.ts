import assert from 'node:assert/strict';
import test from 'node:test';

import { runGoldenPngWorkflowProbe } from './golden-pilot-workflow-probe.ts';

test('Golden PNG probe crosses the public workflow seam for adversarial and cancellation checks', async () => {
  const result = await runGoldenPngWorkflowProbe();

  assert.equal(result.journeyId, 'png-to-webp:upload');
  assert.deepEqual(result.checks, [
    'malformed-input',
    'spoofed-input',
    'wrong-format-output',
    'no-delivery-on-failure',
    'cancellation-lifecycle',
  ]);
  assert.deepEqual(result.observed, {
    malformedOutcome: 'failed',
    spoofedOutcome: 'failed',
    wrongFormatOutcome: 'failed',
    cancellationOutcome: 'cancelled',
    deliveries: 0,
    terminals: 2,
    terminatedWorkers: 1,
  });
  assert.throws(
    () => (result.checks as unknown as string[]).push('semantic-output'),
    TypeError,
  );
});

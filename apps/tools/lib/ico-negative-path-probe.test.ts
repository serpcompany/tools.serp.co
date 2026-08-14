import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ICO_NEGATIVE_PATH_CHECKS,
  proveIcoNegativePaths,
} from './ico-negative-path-probe.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

test('ICO exact journey proves adversarial failure and cancellation without delivery', async () => {
  const proof = await proveIcoNegativePaths({
    validIco: fixture('sample.ico'),
    spoofedNonIco: fixture('sample.png'),
    wrongFormatOutput: fixture('sample.jpg'),
  });
  assert.equal(proof.journeyId, 'ico-to-png:upload');
  assert.deepEqual(proof.checks, ICO_NEGATIVE_PATH_CHECKS);
  assert.deepEqual(proof.observed, {
    failedRuns: 3,
    cancelledRuns: 1,
    deliveries: 0,
    cleanupCalls: 1,
    terminalStatuses: ['failed', 'cancelled'],
  });
});

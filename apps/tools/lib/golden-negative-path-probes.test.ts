import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  GOLDEN_NEGATIVE_PATH_CHECKS,
  proveBatchPngNegativePaths,
  proveBmpToPngNegativePaths,
} from './golden-negative-path-probes.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

test('batch Golden probe proves every negative check through the real workflow', async () => {
  const result = await proveBatchPngNegativePaths({
    png: fixture('sample.png'),
    spoofedNonPng: fixture('sample.bmp'),
  });
  assert.equal(result.journeyId, 'batch-compress-png:multiple-file-upload');
  assert.deepEqual(result.checks, GOLDEN_NEGATIVE_PATH_CHECKS);
  assert.deepEqual(result.observed, {
    failedRuns: 3,
    cancelledRuns: 1,
    deliveries: 0,
    cleanupCalls: 1,
    terminalStatuses: ['failed', 'cancelled'],
  });
});

test('BMP Golden probe proves every negative check through the real workflow', async () => {
  const result = await proveBmpToPngNegativePaths({
    bmp: fixture('sample.bmp'),
    spoofedNonBmp: fixture('sample.png'),
    wrongFormatOutput: fixture('sample.jpg'),
  });
  assert.equal(result.journeyId, 'bmp-to-png:upload');
  assert.deepEqual(result.checks, GOLDEN_NEGATIVE_PATH_CHECKS);
  assert.deepEqual(result.observed, {
    failedRuns: 3,
    cancelledRuns: 1,
    deliveries: 0,
    cleanupCalls: 1,
    terminalStatuses: ['failed', 'cancelled'],
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  proveSvgCompressionNegativePaths,
  SVG_NEGATIVE_PATH_CHECKS,
} from './svg-compression-negative-path-probe.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

test('exact SVG workflow proves fail-closed inputs, output, delivery, and cancellation', async () => {
  const proof = await proveSvgCompressionNegativePaths({
    safeSvg: fixture('svg-compression-complex.svg'),
    spoofedNonSvg: fixture('sample.png'),
  });

  assert.equal(proof.journeyId, 'compress-svg:upload');
  assert.deepEqual(proof.checks, SVG_NEGATIVE_PATH_CHECKS);
  assert.equal(proof.observed.deliveries, 0);
  assert.equal(proof.observed.terminatedWorkers, 1);
  assert.deepEqual(proof.observed.terminalStatuses, [
    'failed',
    'failed',
    'failed',
    'cancelled',
  ]);
});

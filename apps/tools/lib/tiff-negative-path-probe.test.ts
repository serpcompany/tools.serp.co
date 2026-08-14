import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { proveTiffNegativePaths } from './tiff-negative-path-probe.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

for (const [toolId, validFixture] of [
  ['tif-to-png', 'tiff/rgb-little-stripped-none.tiff'],
  ['tiff-to-png', 'tiff/rgb-big-tiled-lzw.tiff'],
] as const) {
  test(`${toolId} proves its own negative and cancellation checks`, async () => {
    const proof = await proveTiffNegativePaths(toolId, {
      validTiff: fixture(validFixture),
      spoofedNonTiff: fixture('sample.png'),
      wrongFormatOutput: fixture('sample.jpg'),
    });
    assert.equal(proof.journeyId, `${toolId}:upload`);
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
}

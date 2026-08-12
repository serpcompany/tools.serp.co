import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runCurrentSeamProbes } from './tool-workflow-proof-seam-probes.ts';

test('public ToolWorkflow.run rejects a lying processor and cancellation releases resources', async () => {
  const [pngBytes, jpegBytes] = await Promise.all([
    readFile('apps/tools/benchmarks/fixtures/sample.png'),
    readFile('apps/tools/benchmarks/fixtures/sample.jpg'),
  ]);
  const probes = await runCurrentSeamProbes({ pngBytes, jpegBytes });

  assert.deepEqual(probes.lyingProcessor, {
    verdict: 'pass',
    outcome: 'failed',
    errorCode: 'invalid-result',
    delivered: false,
    resourcesReleased: true,
    terminalCount: 1,
  });
  assert.deepEqual(probes.cancellation, {
    verdict: 'pass',
    outcome: 'cancelled',
    delivered: false,
    resourcesReleased: true,
    terminalCount: 1,
    cancelledAt: 'delivering',
  });
});

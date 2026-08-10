import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBrowserScope,
  summarizeNavigationTimings,
} from './browser-evidence.mjs';

test('browser scope identifies filtered Tools without retaining their ids', () => {
  const evidence = buildBrowserScope({
    mode: 'smoke',
    environment: 'preview',
    toolIds: ['character-counter'],
    filtered: true,
  });

  assert.equal(evidence.label, 'browser-smoke-preview-subset');
  assert.deepEqual(evidence.inputHashes, [
    'sha256:9f7829390d0da74b08dc6ba1a660827059eabeb356d32c038a429dc6902048e5',
  ]);
  assert.doesNotMatch(JSON.stringify(evidence), /character-counter/);
});

test('benchmark evidence retains sanitized navigation aggregates', () => {
  assert.deepEqual(summarizeNavigationTimings([100, 20, 50, 40, 30]), {
    samples: 5,
    minMs: 20,
    p50Ms: 40,
    p95Ms: 100,
    maxMs: 100,
  });
  assert.deepEqual(summarizeNavigationTimings([]), {});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBrowserScope,
  summarizeNavigationTimings,
} from './browser-evidence.mjs';

test('browser scope retains exact Tool ids and representative semantic invariants', () => {
  const evidence = buildBrowserScope({
    mode: 'smoke',
    environment: 'preview',
    toolIds: ['png-to-webp', 'video-downloader', 'csv-to-json'],
    filtered: true,
  });

  assert.equal(evidence.label, 'browser-smoke-preview-subset');
  assert.deepEqual(evidence.toolIds, [
    'png-to-webp',
    'video-downloader',
    'csv-to-json',
  ]);
  assert.deepEqual(evidence.invariants, [
    'generic-file-exact-output',
    'table-row-header-value-semantics',
    'url-stream-exact-output',
  ]);
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

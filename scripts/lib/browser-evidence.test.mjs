import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBrowserScope,
  summarizeNavigationTimings,
} from './browser-evidence.mjs';

test('smoke scope retains semantic invariants associated with each Tool id', () => {
  const evidence = buildBrowserScope({
    mode: 'smoke',
    environment: 'preview',
    toolIds: ['png-to-webp', 'video-downloader', 'csv-to-json'],
    filtered: true,
  });

  assert.equal(evidence.label, 'browser-smoke-preview-subset');
  assert.deepEqual(evidence.tools, [
    {
      toolId: 'png-to-webp',
      invariants: ['generic-file-exact-output'],
    },
    {
      toolId: 'video-downloader',
      invariants: ['url-stream-exact-output'],
    },
    {
      toolId: 'csv-to-json',
      invariants: ['table-row-header-value-semantics'],
    },
  ]);
});

test('BMP smoke scope names decoded raster and PDF content invariants', () => {
  assert.deepEqual(
    buildBrowserScope({
      mode: 'smoke',
      environment: 'local',
      toolIds: [
        'bmp-to-jpeg',
        'bmp-to-jpg',
        'bmp-to-pdf',
        'bmp-to-png',
        'bmp-to-webp',
      ],
      filtered: true,
    }).tools,
    [
      { toolId: 'bmp-to-jpeg', invariants: ['bmp-decoded-content-semantics'] },
      { toolId: 'bmp-to-jpg', invariants: ['bmp-decoded-content-semantics'] },
      { toolId: 'bmp-to-pdf', invariants: ['bmp-pdf-page-image-semantics'] },
      { toolId: 'bmp-to-png', invariants: ['bmp-decoded-content-semantics'] },
      { toolId: 'bmp-to-webp', invariants: ['bmp-decoded-content-semantics'] },
    ],
  );
});

test('benchmark scope identifies Tools without claiming semantic correctness', () => {
  const evidence = buildBrowserScope({
    mode: 'benchmark',
    environment: 'preview',
    toolIds: ['png-to-webp', 'video-downloader'],
    filtered: true,
  });

  assert.deepEqual(evidence.tools, [
    { toolId: 'png-to-webp', invariants: [] },
    { toolId: 'video-downloader', invariants: [] },
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

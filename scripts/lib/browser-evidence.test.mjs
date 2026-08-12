import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachConsoleWarningEvidence,
  buildBrowserScope,
  classifyConsoleWarning,
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
      journeyIds: ['png-to-webp:upload'],
      invariants: ['generic-file-exact-output'],
    },
    {
      toolId: 'video-downloader',
      journeyIds: ['video-downloader:direct-url'],
      invariants: ['url-stream-exact-output'],
    },
    {
      toolId: 'csv-to-json',
      journeyIds: ['csv-to-json:upload'],
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
      {
        toolId: 'bmp-to-jpeg',
        journeyIds: ['bmp-to-jpeg:upload'],
        invariants: ['bmp-decoded-content-semantics'],
      },
      {
        toolId: 'bmp-to-jpg',
        journeyIds: ['bmp-to-jpg:upload'],
        invariants: ['bmp-decoded-content-semantics'],
      },
      {
        toolId: 'bmp-to-pdf',
        journeyIds: ['bmp-to-pdf:upload'],
        invariants: ['bmp-pdf-page-image-semantics'],
      },
      {
        toolId: 'bmp-to-png',
        journeyIds: ['bmp-to-png:upload'],
        invariants: ['bmp-decoded-content-semantics'],
      },
      {
        toolId: 'bmp-to-webp',
        journeyIds: ['bmp-to-webp:upload'],
        invariants: ['bmp-decoded-content-semantics'],
      },
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
    { toolId: 'png-to-webp', journeyIds: [], invariants: [] },
    { toolId: 'video-downloader', journeyIds: [], invariants: [] },
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

test('console warning evidence is classified, deduplicated, and attached per Tool without raw text', () => {
  assert.equal(
    classifyConsoleWarning(
      'AdSense head tag does not support data-nscript attribute for https://secret.example/path?token=nope',
    ),
    'adsense-script-attribute',
  );
  assert.equal(
    classifyConsoleWarning('unexpected warning containing private@example.com'),
    'other-console-warning',
  );

  assert.deepEqual(
    attachConsoleWarningEvidence(
      [{ toolId: 'pdf-reader', invariants: ['specialized-output-semantics'] }],
      [
        {
          id: 'pdf-reader',
          consoleWarnings: [
            'other-console-warning',
            'adsense-script-attribute',
            'other-console-warning',
          ],
        },
      ],
    ),
    [
      {
        toolId: 'pdf-reader',
        invariants: ['specialized-output-semantics'],
        warnings: ['adsense-script-attribute', 'other-console-warning'],
      },
    ],
  );
});

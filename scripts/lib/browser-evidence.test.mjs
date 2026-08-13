import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachConsoleWarningEvidence,
  attachJourneyResultEvidence,
  buildBrowserScope,
  classifyConsoleWarning,
  finalizeJourneyResults,
  summarizeNavigationTimings,
  validateBrowserEvidenceRevision,
} from './browser-evidence.mjs';

test('smoke scope derives exact journey requirements from the Tool Journey module', () => {
  const evidence = buildBrowserScope({
    mode: 'smoke',
    environment: 'preview',
    toolIds: ['png-to-webp', 'video-downloader', 'csv-to-json'],
    filtered: true,
  });

  assert.equal(evidence.label, 'browser-smoke-preview-subset');
  assert.deepEqual(
    evidence.tools.map((tool) => ({
      toolId: tool.toolId,
      journeys: tool.journeys.map((journey) => ({
        journeyId: journey.journeyId,
        fixtureKind: journey.fixtureKind,
        fixtureReference: journey.fixtureReference,
        invariantId: journey.invariantId,
        revisionKeys: Object.keys(journey.inputRevisions),
      })),
    })),
    [
      {
        toolId: 'png-to-webp',
        journeys: [
          {
            journeyId: 'png-to-webp:upload',
            fixtureKind: 'format-fixture',
            fixtureReference: 'formats/png',
            invariantId: 'generic-file-exact-output',
            revisionKeys: [
              'fixture-contract',
              'fixture-content',
              'journey-contract',
              'semantic-invariant',
              'verification-policy',
              'executable-sources',
              'dependency-lock',
              'runner-sources',
            ],
          },
        ],
      },
      {
        toolId: 'video-downloader',
        journeys: [
          {
            journeyId: 'video-downloader:direct-url',
            fixtureKind: 'direct-url-fixture',
            fixtureReference: 'tools/video-downloader',
            invariantId: 'url-stream-exact-output',
            revisionKeys: [
              'fixture-contract',
              'fixture-content',
              'journey-contract',
              'semantic-invariant',
              'verification-policy',
              'executable-sources',
              'dependency-lock',
              'runner-sources',
            ],
          },
        ],
      },
      {
        toolId: 'csv-to-json',
        journeys: [
          {
            journeyId: 'csv-to-json:upload',
            fixtureKind: 'format-fixture',
            fixtureReference: 'formats/csv',
            invariantId: 'table-row-header-value-semantics',
            revisionKeys: [
              'fixture-contract',
              'fixture-content',
              'journey-contract',
              'semantic-invariant',
              'verification-policy',
              'executable-sources',
              'dependency-lock',
              'runner-sources',
            ],
          },
        ],
      },
    ],
  );
});

test('BMP scope keeps each exact decoded-content or PDF invariant', () => {
  const tools = buildBrowserScope({
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
  }).tools;

  assert.deepEqual(
    tools.map((tool) => [
      tool.toolId,
      tool.journeys[0]?.journeyId,
      tool.journeys[0]?.invariantId,
    ]),
    [
      ['bmp-to-jpeg', 'bmp-to-jpeg:upload', 'bmp-decoded-content-semantics'],
      ['bmp-to-jpg', 'bmp-to-jpg:upload', 'bmp-decoded-content-semantics'],
      ['bmp-to-pdf', 'bmp-to-pdf:upload', 'bmp-pdf-page-image-semantics'],
      ['bmp-to-png', 'bmp-to-png:upload', 'bmp-decoded-content-semantics'],
      ['bmp-to-webp', 'bmp-to-webp:upload', 'bmp-decoded-content-semantics'],
    ],
  );
});

test('benchmark scope identifies Tools without claiming journey correctness', () => {
  assert.deepEqual(
    buildBrowserScope({
      mode: 'benchmark',
      environment: 'preview',
      toolIds: ['png-to-webp', 'video-downloader'],
      filtered: true,
    }).tools,
    [
      { toolId: 'png-to-webp', journeys: [] },
      { toolId: 'video-downloader', journeys: [] },
    ],
  );
});

test('browser result evidence records each journey outcome instead of promoting aggregate success', () => {
  const tools = buildBrowserScope({
    mode: 'smoke',
    environment: 'local',
    toolIds: ['audio-to-text'],
    filtered: true,
  }).tools;

  const evidence = attachJourneyResultEvidence(tools, [
    {
      id: 'audio-to-text',
      status: 'warn',
      journeyResults: [
        {
          journeyId: 'audio-to-text:upload',
          outcome: 'passed',
          reasonCode: null,
          fixtureSha256: 'a'.repeat(64),
        },
        {
          journeyId: 'audio-to-text:extractor-url',
          outcome: 'skipped',
          reasonCode: 'preview-required',
          fixtureSha256: 'b'.repeat(64),
        },
      ],
    },
  ]);

  assert.deepEqual(
    evidence[0].journeys.map((journey) => ({
      journeyId: journey.journeyId,
      outcome: journey.outcome,
      reasonCode: journey.reasonCode,
      checks: journey.checks,
    })),
    [
      {
        journeyId: 'audio-to-text:upload',
        outcome: 'passed',
        reasonCode: null,
        checks: ['valid-fixture', 'semantic-output', 'required-environment'],
      },
      {
        journeyId: 'audio-to-text:extractor-url',
        outcome: 'skipped',
        reasonCode: 'preview-required',
        checks: [],
      },
    ],
  );
  const extractor = evidence[0].journeys.find(
    (journey) => journey.journeyId === 'audio-to-text:extractor-url',
  );
  assert.equal(extractor.fixture.kind, 'literal');
});

test('a later Tool warning cannot rewrite an already passed journey', () => {
  assert.deepEqual(
    finalizeJourneyResults({
      plannedJourneys: [
        { journeyId: 'one', fixtureSha256: 'a'.repeat(64) },
        { journeyId: 'two', fixtureSha256: 'b'.repeat(64) },
      ],
      outcomes: [['one', { outcome: 'passed', reasonCode: null }]],
      activeJourneyId: null,
      status: 'warn',
    }).map(({ journeyId, outcome, reasonCode }) => ({
      journeyId,
      outcome,
      reasonCode,
    })),
    [
      { journeyId: 'one', outcome: 'passed', reasonCode: null },
      {
        journeyId: 'two',
        outcome: 'skipped',
        reasonCode: 'browser-check-skipped',
      },
    ],
  );
});

test('browser evidence revision must match the actual clean checkout', () => {
  assert.doesNotThrow(() =>
    validateBrowserEvidenceRevision(
      { revision: 'a'.repeat(40), dirty: false },
      { revision: 'a'.repeat(40), dirty: false },
    ),
  );
  assert.throws(
    () =>
      validateBrowserEvidenceRevision(
        { revision: 'a'.repeat(40), dirty: false },
        { revision: 'b'.repeat(40), dirty: false },
      ),
    /checked-out Git HEAD/,
  );
  assert.throws(
    () =>
      validateBrowserEvidenceRevision(
        { revision: 'a'.repeat(40), dirty: false },
        { revision: 'a'.repeat(40), dirty: true },
      ),
    /checkout is dirty/,
  );
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

test('console warning evidence is classified, deduplicated, and attached without raw text', () => {
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
      [{ toolId: 'pdf-reader', journeys: [] }],
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
        journeys: [],
        warnings: ['adsense-script-attribute', 'other-console-warning'],
      },
    ],
  );
});

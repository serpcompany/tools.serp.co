import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertGoldenBrowserManifest,
  summarizeGoldenPilotProjection,
} from './golden-pilot-contract.mjs';

const ids = [
  'audio-to-text:extractor-url',
  'audio-to-text:upload',
  'audio-to-transcript:direct-url',
  'batch-compress-png:multiple-file-upload',
  'bmp-to-png:upload',
  'compress-pdf:upload',
  'csv-to-json:upload',
  'pdf-reader:upload',
  'png-to-webp:upload',
  'video-downloader:direct-url',
];

function manifest(overrides = {}) {
  return {
    scope: {
      tools: ids.map((journeyId) => ({
        toolId: journeyId.split(':')[0],
        journeys: [
          {
            journeyId,
            outcome: journeyId === 'compress-pdf:upload' ? 'warned' : 'passed',
            reasonCode:
              journeyId === 'compress-pdf:upload'
                ? 'browser-check-warning'
                : null,
            checks:
              journeyId === 'compress-pdf:upload'
                ? ['no-delivery-on-failure']
                : ['semantic-output'],
            ...overrides[journeyId],
          },
        ],
      })),
    },
  };
}

test('Golden proof accepts only exact semantic output and honest no-delivery evidence', () => {
  assert.equal(assertGoldenBrowserManifest(manifest()).length, 10);
  assert.throws(
    () =>
      assertGoldenBrowserManifest(
        manifest({ 'bmp-to-png:upload': { checks: ['valid-fixture'] } }),
      ),
    /semantic-output/,
  );
  assert.throws(
    () =>
      assertGoldenBrowserManifest(
        manifest({ 'compress-pdf:upload': { checks: [] } }),
      ),
    /no-delivery/,
  );
});

test('Golden package separates completed execution from a repair decision', () => {
  const rows = ids.map((journeyId) => ({
    journeyId,
    evidenceState: 'warned',
  }));

  assert.deepEqual(summarizeGoldenPilotProjection(rows), {
    executionStatus: 'completed',
    verificationDecision: 'repair',
    acceptanceStatus: 'not-accepted',
    evidenceCounts: { warned: 10 },
  });
});

test('Golden package is ready for a human continue decision only at the declared evidence boundary', () => {
  const rows = ids.map((journeyId) => ({
    journeyId,
    evidenceState: journeyId === 'compress-pdf:upload' ? 'warned' : 'verified',
  }));

  assert.deepEqual(summarizeGoldenPilotProjection(rows), {
    executionStatus: 'completed',
    verificationDecision: 'continue',
    acceptanceStatus: 'ready-for-maintainer-decision',
    evidenceCounts: { verified: 9, warned: 1 },
  });
  assert.throws(
    () => summarizeGoldenPilotProjection(rows.slice(1)),
    /fixed journey membership/,
  );
});

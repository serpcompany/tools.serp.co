import assert from 'node:assert/strict';
import test from 'node:test';

import { assertGoldenBrowserManifest } from './golden-pilot-contract.mjs';

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

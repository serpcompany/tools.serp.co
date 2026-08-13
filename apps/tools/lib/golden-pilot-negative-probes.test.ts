import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runGoldenCsvNegativeProbe,
  runGoldenPdfReaderNegativeProbe,
  runGoldenTranscriptionDirectUrlNegativeProbe,
  runGoldenTranscriptionUploadNegativeProbe,
  runGoldenVideoDownloaderNegativeProbe,
} from './golden-pilot-negative-probes.ts';

for (const [name, probe] of [
  ['csv-to-json:upload', runGoldenCsvNegativeProbe],
  ['pdf-reader:upload', runGoldenPdfReaderNegativeProbe],
  ['video-downloader:direct-url', runGoldenVideoDownloaderNegativeProbe],
] as const) {
  test(`${name} proves every required negative check through production seams`, async () => {
    const result = await probe();

    assert.equal(result.journeyId, name);
    assert.deepEqual(result.checks, [
      'malformed-input',
      'spoofed-input',
      'wrong-format-output',
      'no-delivery-on-failure',
      'cancellation-lifecycle',
    ]);
    assert.deepEqual(result.observed.malformed, {
      status: 'failed',
      errorCode: 'invalid-request',
      deliveries: 0,
      terminal: name === 'video-downloader:direct-url' ? 'failed' : null,
    });
    assert.deepEqual(result.observed.spoofed, {
      status: 'failed',
      errorCode: 'invalid-request',
      deliveries: 0,
      terminal: name === 'video-downloader:direct-url' ? 'failed' : null,
    });
    assert.deepEqual(result.observed.cancelled, {
      status: 'cancelled',
      errorCode: null,
      deliveries: 0,
      terminal: 'cancelled',
    });
    assert.equal(result.observed.totalDeliveries, 0);
    assert.equal(result.observed.wrongOutputRejected, true);
    assert.throws(() => (result.checks as string[]).push('extra-check'));
  });
}

for (const [name, probe] of [
  ['audio-to-text:upload', runGoldenTranscriptionUploadNegativeProbe],
  [
    'audio-to-transcript:direct-url',
    runGoldenTranscriptionDirectUrlNegativeProbe,
  ],
] as const) {
  test(`${name} rejects malformed, spoofed, empty output, and cancellation`, async () => {
    const result = await probe();
    assert.equal(result.journeyId, name);
    assert.deepEqual(result.checks, [
      'malformed-input',
      'spoofed-input',
      'wrong-format-output',
      'no-delivery-on-failure',
      'cancellation-lifecycle',
    ]);
    assert.deepEqual(result.observed, {
      failedRuns: 3,
      cancelledRuns: 1,
      deliveries: 0,
    });
  });
}

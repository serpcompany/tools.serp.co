import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ICO_CANDIDATE_TERMINATION_STAGES,
  ICO_CANDIDATE_WORKER_MAX_BYTES,
  discoverIcoWorkerChunkId,
  parseIcoPreviewCandidateArguments,
} from './prove-ico-preview-candidate.mjs';

const fullRevision = 'a'.repeat(40);

test('candidate proof accepts only an exact non-production preview target', () => {
  assert.deepEqual(
    parseIcoPreviewCandidateArguments([
      '--base-url',
      'https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev',
      '--revision',
      fullRevision,
    ]),
    {
      baseUrl:
        'https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev',
      revision: fullRevision,
    },
  );

  assert.throws(
    () =>
      parseIcoPreviewCandidateArguments([
        '--base-url',
        'https://tools.serp.co',
        '--revision',
        fullRevision,
      ]),
    /refuses non-preview targets/,
  );
  assert.throws(
    () =>
      parseIcoPreviewCandidateArguments([
        '--base-url',
        'https://example-preview.test',
        '--revision',
        'abc123',
      ]),
    /exact 40-character revision/,
  );
});

test('candidate proof discovers the emitted worker chunk from compiled code', () => {
  assert.equal(
    discoverIcoWorkerChunkId(
      'convert-ico-to-png;new Worker(new URL(r.u(4812),r.b),{type:"module"})',
    ),
    4812,
  );
  assert.equal(discoverIcoWorkerChunkId('unrelated chunk'), undefined);
});

test('candidate proof fixes its worker and termination proof budgets', () => {
  assert.equal(ICO_CANDIDATE_WORKER_MAX_BYTES, 128 * 1_024);
  assert.deepEqual(ICO_CANDIDATE_TERMINATION_STAGES, [
    'decode',
    'select',
    'verify',
  ]);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertTranscriptMatchesFixture } from './transcription-semantics.mjs';

const expected =
  'The shared workflow test confirms that browser transcription returns clear and useful text.';

test('fixture transcript accepts punctuation and bounded recognition differences', () => {
  assert.deepEqual(
    assertTranscriptMatchesFixture(
      'Shared workflow test confirms browser transcription returns clear, useful text!',
      expected,
    ),
    {
      expectedWordCount: 13,
      observedWordCount: 10,
      wordErrors: 3,
      wordErrorRate: 3 / 13,
    },
  );
});

test('fixture transcript rejects unrelated or truncated nonempty output', () => {
  assert.throws(
    () =>
      assertTranscriptMatchesFixture(
        'This output is definitely nonempty.',
        expected,
      ),
    /did not match the owned speech fixture/,
  );
  assert.throws(
    () => assertTranscriptMatchesFixture('The shared workflow test', expected),
    /did not match the owned speech fixture/,
  );
});

test('fixture transcript rejects a missing or meaningless oracle', () => {
  assert.throws(
    () => assertTranscriptMatchesFixture('hello', ''),
    /oracle must contain at least five words/,
  );
});

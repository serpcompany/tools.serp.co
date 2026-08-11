import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the production transcription worker preserves its external module import', async () => {
  const source = await readFile(
    new URL('./transcribe.worker.js', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import\(\/\* webpackIgnore: true \*\/ TRANSFORMERS_URL\)/,
  );
});

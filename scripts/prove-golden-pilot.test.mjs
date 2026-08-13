import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./prove-golden-pilot.mjs', import.meta.url),
  'utf8',
);

test('Golden pilot command owns the fixed journey portfolio and human report', () => {
  for (const toolId of [
    'audio-to-text',
    'audio-to-transcript',
    'batch-compress-png',
    'bmp-to-png',
    'compress-pdf',
    'csv-to-json',
    'pdf-reader',
    'png-to-webp',
    'video-downloader',
  ]) {
    assert.match(source, new RegExp(`['"]${toolId}['"]`));
  }
  assert.match(source, /mp4-to-webm/);
  assert.match(source, /Golden Journey pilot/);
  assert.match(source, /continue \/ repair \/ reconsider/i);
  assert.match(source, /golden-pilot-currentness-proof\.ts/);
  assert.match(source, /recordRunEvidence/);
});

test('Golden pilot command documents one clean-checkout invocation', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/prove-golden-pilot.mjs', '--help'],
    {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--environment <local\|preview>/);
  assert.match(result.stdout, /--base-url <origin>/);
  assert.match(result.stdout, /--revision <full-sha>/);
});

test('Golden pilot uses preview evidence retention policy outside local runs', () => {
  assert.match(
    source,
    /options\.environment === 'local'[\s\S]*retentionClass: 'retained-debug'/,
  );
  assert.doesNotMatch(
    source,
    /status: 'success',\s*retentionClass: 'retained-debug'/,
  );
});

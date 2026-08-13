import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./prove-golden-pilot.mjs', import.meta.url),
  'utf8',
);

test('Golden pilot command consumes the canonical portfolio and renders the human report', () => {
  assert.match(source, /goldenToolJourneyPilot\.toolIds/);
  assert.match(source, /goldenToolJourneyPilot\.membershipHash/);
  assert.match(source, /mp4-to-webm/);
  assert.match(source, /Golden Journey pilot/);
  assert.match(source, /continue \/ repair \/ reconsider/i);
  assert.match(source, /scripts\/prove-golden-currentness\.mjs/);
  assert.match(source, /options\.environment === 'preview'/);
  assert.match(source, /scripts\/lib\/golden-pilot-currentness-proof\.ts/);
  assert.match(source, /recordRunEvidence/);
  assert.match(source, /<h2>Before and after<\/h2>/);
  assert.match(source, /beforeAfter:/);
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

test('Golden report separates browser observations from evidence acceptance', () => {
  assert.match(source, /<th>Observed result<\/th>/);
  assert.match(source, /<th>Evidence state<\/th>/);
  assert.match(source, /journey\.observedResult/);
  assert.match(source, /journey\.evidenceResult/);
  assert.match(source, /packageSummary\.verificationDecision/);
  assert.match(source, /does not by itself mean the pilot was accepted/);
  assert.doesNotMatch(source, /Golden Journey pilot proof passed/);
});

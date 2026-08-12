import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('./check-tool-factory-table.mjs', import.meta.url),
);
const source = readFileSync(script, 'utf8');

test('hosted Tool Factory check requires an exact deployed revision before opening a browser', () => {
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--environment',
      'DEV/STAGING',
      '--revision',
      'short',
      '--base-url',
      'https://preview.example.test',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /full deployed revision/);
});

test('hosted Tool Factory check refuses to send Access credentials to any noncanonical origin', () => {
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--environment',
      'DEV/STAGING',
      '--revision',
      'a'.repeat(40),
      '--base-url',
      'https://hostile.example.test',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, TOOL_FACTORY_CF_AUTHORIZATION: 'restricted' },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical Wayfinder origin/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /restricted/);
});

test('hosted Tool Factory check owns authenticated browser interactions and screenshot evidence', () => {
  assert.match(source, /process\.env\.TOOL_FACTORY_CF_AUTHORIZATION/);
  assert.match(source, /name:\s*['"]CF_Authorization['"]/);
  assert.match(source, /getByLabel\(['"]Search all Tools['"]\)/);
  assert.match(source, /Filter by support/);
  assert.match(source, /getByLabel\(['"]Description['"]\)\.check/);
  assert.match(source, /name:\s*['"]Next['"]/);
  assert.match(source, /getByRole\(['"]dialog['"]\)/);
  assert.match(source, /page\.screenshot/);
  assert.match(source, /recordRunEvidence/);
  assert.match(source, /command:\s*['"]check:tool-factory['"]/);
  assert.match(source, /linkedWork:\s*\[['"]#50['"], ['"]#107['"]\]/);
  assert.doesNotMatch(source, /console\.log\(.*accessCookie/);
});

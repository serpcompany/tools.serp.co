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
  assert.match(result.stderr, /full revision/);
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

test('local Tool Factory check refuses Access credentials before opening a browser', () => {
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--environment',
      'LOCAL',
      '--base-url',
      'https://hostile.example.test',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, TOOL_FACTORY_CF_AUTHORIZATION: 'restricted' },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refuse Cloudflare Access credentials/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /restricted/);
});

test('local Tool Factory evidence derives revision and dirty state from Git', () => {
  assert.match(
    source,
    /execFileSync\(['"]git['"], \[['"]rev-parse['"], ['"]HEAD['"]\]/,
  );
  assert.match(
    source,
    /status['"], ['"]--short['"], ['"]--untracked-files=all['"]/,
  );
  assert.match(source, /revision:\s*source\.revision/);
  assert.match(
    source,
    /dirty:\s*args\.environment === ['"]LOCAL['"] \? source\.dirty/,
  );
});

test('hosted Tool Factory check owns authenticated browser interactions and screenshot evidence', () => {
  assert.match(source, /process\.env\.TOOL_FACTORY_CF_AUTHORIZATION/);
  assert.match(source, /name:\s*['"]CF_Authorization['"]/);
  assert.match(source, /getByLabel\(['"]Search all Tools['"]\)/);
  assert.match(source, /__reactFiber/);
  assert.match(source, /Filter by support/);
  assert.match(source, /getByLabel\(['"]Description['"]\)\.check/);
  assert.match(source, /name:\s*['"]Next['"]/);
  assert.match(source, /sharedUrl\.searchParams\.get\(['"]support['"]\)/);
  assert.match(source, /copiedPage\.goto\(sharedUrl\.href/);
  assert.match(source, /page\.goBack/);
  assert.match(source, /page\.goForward/);
  assert.match(source, /new URL\(page\.url\(\)\)\.search/);
  assert.match(source, /getByRole\(['"]dialog['"]\)/);
  assert.match(source, /Latest exact Tool test/);
  assert.match(source, /Converted a real PNG and produced a WebP file/);
  assert.match(source, /Not tested here/);
  assert.match(source, /Family verification policy \(not an exact Tool test\)/);
  assert.match(source, /dialog\.screenshot/);
  assert.match(source, /recordRunEvidence/);
  assert.match(source, /command:\s*['"]check:tool-factory['"]/);
  assert.match(
    source,
    /linkedWork:\s*\[['"]#50['"], ['"]#105['"], ['"]#106['"], ['"]#107['"]\]/,
  );
  assert.doesNotMatch(source, /console\.log\(.*accessCookie/);
});

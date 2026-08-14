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
  assert.match(source, /OSS expansion planner/);
  assert.match(source, /Show 4 exact Tools/);
  assert.match(source, /Filter by current execution/);
  assert.match(source, /Filter by preferred target/);
  assert.match(source, /Filter by server dependency/);
  assert.match(source, /Filter by browser opportunity/);
  assert.match(source, /installed-package presence/);
  assert.match(source, /searchParams\.get\(['"]expansion['"]\)/);
  assert.match(source, /copiedExpansionPage\.goto\(expansionUrl\.href/);
  assert.match(source, /Journey verification evidence/);
  assert.match(source, /Open Golden Journey pilot/);
  assert.match(source, /Fixed membership sha256:cf077705/);
  assert.match(source, /golden-pilot-source-view\.ts/);
  assert.match(source, /expectedGoldenPilot\.rows/);
  assert.match(source, /expected\.resultLabel/);
  assert.match(source, /expected\.remainingGap/);
  assert.match(source, /detailEvidenceLabel\(expectedPng\.evidenceState\)/);
  assert.match(source, /stale:\s*['"]Stale evidence['"]/);
  assert.match(source, /detailEvidenceLabel\(expectedBmp\.evidenceState\)/);
  assert.match(source, /expectedBmp\.remainingGap/);
  assert.match(source, /expectedAudioNoEvidence/);
  assert.match(
    source,
    /deriveScreenshotPath\(args\.screenshot, ['"]golden-pilot['"]\)/,
  );
  assert.match(source, /statSync\(screenshotPaths\.goldenPilot\)\.size > 0/);
  assert.match(source, /3g2-to-mp4/);
  assert.match(source, /Candidate approaches · not verified support/);
  assert.match(source, /No retained evidence/);
  assert.match(source, /Family verification policy \(not an exact Tool test\)/);
  assert.match(source, /planner\.screenshot/);
  assert.match(
    source,
    /deriveScreenshotPath\(args\.screenshot, ['"]github-work['"]\)/,
  );
  assert.match(
    source,
    /deriveScreenshotPath\(args\.screenshot, ['"]runtime-activity['"]\)/,
  );
  assert.match(
    source,
    /assert\.notEqual\(screenshotPaths\.planner, screenshotPaths\.githubWork\)/,
  );
  assert.match(source, /statSync\(screenshotPaths\.planner\)\.size > 0/);
  assert.match(source, /statSync\(screenshotPaths\.githubWork\)\.size > 0/);
  assert.match(
    source,
    /statSync\(screenshotPaths\.runtimeActivity\)\.size > 0/,
  );
  assert.match(source, /Recent staging activity/);
  assert.match(source, /No recent staging data/);
  assert.match(source, /private DEV\/STAGING D1 binding/);
  assert.match(source, /getByText\(['"]GitHub work['"]/);
  assert.match(source, /getByText\(['"]No tracked work['"]/);
  assert.match(source, /Work tracking not loaded/);
  assert.match(source, /point-in-time snapshot/);
  assert.match(source, /Open pull request/);
  assert.match(source, /Closed issue/);
  assert.match(source, /renderer:transcription/);
  assert.match(source, /screenshot\(\{ path: screenshotPaths\.githubWork \}\)/);
  assert.match(source, /recordRunEvidence/);
  assert.match(source, /command:\s*['"]check:tool-factory['"]/);
  assert.match(source, /linkedWork:\s*\[[\s\S]*['"]#124['"][\s\S]*\]/);
  assert.doesNotMatch(source, /console\.log\(.*accessCookie/);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GENERIC_SMOKE_CAPABILITY_VERSION,
  getGenericSmokeExpectation,
} from './lib/generic-smoke-capabilities.mjs';

const runnerPath = fileURLToPath(
  new URL('./run-browser-check.mjs', import.meta.url),
);
const runnerSource = readFileSync(runnerPath, 'utf8');

function runLocalBrowserFixture(t, { mode = 'smoke', envOverrides = {} } = {}) {
  const artifactRoot = mkdtempSync(
    path.join(tmpdir(), 'tools-serp-browser-test-'),
  );
  t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--mode',
      mode,
      '--environment',
      'local',
      '--base-url',
      'http://localhost:3000',
      '--revision',
      'a'.repeat(40),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TOOLS_SERP_TEST_REPOSITORY_ROOT: artifactRoot,
        ...envOverrides,
      },
    },
  );
  return { artifactRoot, result };
}

function readOnlyArtifactRun(artifactRoot) {
  const runsRoot = path.join(artifactRoot, '.artifacts', 'runs');
  const runNames = readdirSync(runsRoot);
  assert.equal(runNames.length, 1);
  const runRoot = path.join(runsRoot, runNames[0]);
  return {
    manifest: JSON.parse(
      readFileSync(path.join(runRoot, 'manifest.json'), 'utf8'),
    ),
    summary: readFileSync(path.join(runRoot, 'summary.txt'), 'utf8'),
  };
}

test('browser runner documents separate smoke and benchmark modes', () => {
  const result = spawnSync(process.execPath, [runnerPath, '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--mode <smoke\|benchmark>.*required/i);
  assert.match(
    result.stdout,
    /--environment <local\|preview\|production>.*required/i,
  );
  assert.match(result.stdout, /--revision <40-character-commit>.*required/i);
  assert.match(result.stdout, /smoke.*correctness/i);
  assert.match(result.stdout, /benchmark.*performance/i);
  assert.match(result.stdout, /structured artifact/i);
});

test('browser modes keep correctness and performance execution separate', () => {
  assert.match(
    runnerSource,
    /async function runSmokeCheck[\s\S]*runFunctionalTest/,
  );
  assert.match(
    runnerSource,
    /async function runBenchmark[\s\S]*performance\.getEntriesByType/,
  );
  assert.match(runnerSource, /modeHandlers\[options\.mode\]/);
  assert.doesNotMatch(runnerSource, /options\.mode ===/);
  assert.match(runnerSource, /recordRunEvidence/);
  assert.match(runnerSource, /summarizeNavigationTimings/);
  assert.match(runnerSource, /evidenceInputHashes/);
  assert.match(runnerSource, /buildBrowserScope/);
  assert.doesNotMatch(runnerSource, /benchmark-results\.json/);
});

test('smoke treats the truthful generic unsupported outcome as safe failure', () => {
  assert.match(runnerSource, /This conversion is not currently supported/);
  assert.match(runnerSource, /safe failure/i);
  assert.doesNotMatch(runnerSource, /data-generic-contract/);
  assert.match(runnerSource, /getGenericSmokeExpectation/);
  assert.equal(GENERIC_SMOKE_CAPABILITY_VERSION, 'generic-adapters-v3-bmp');
  for (const id of ['png-to-webp', 'webp-to-jpg', 'heic-to-jpg']) {
    const [from, to] = id.split('-to-');
    assert.equal(
      getGenericSmokeExpectation({ id, from, to, operation: 'convert' }),
      'supported',
      id,
    );
  }
  for (const id of [
    'bmp-to-jpeg',
    'bmp-to-jpg',
    'bmp-to-pdf',
    'bmp-to-png',
    'bmp-to-webp',
  ]) {
    assert.equal(
      getGenericSmokeExpectation({
        id,
        from: 'bmp',
        to: id.slice('bmp-to-'.length),
        operation: 'convert',
      }),
      'supported',
      id,
    );
  }
  for (const id of ['bmp-to-svg', 'bmp-to-tiff', 'bmp-to-ktx2']) {
    assert.equal(
      getGenericSmokeExpectation({
        id,
        from: 'bmp',
        to: id.slice('bmp-to-'.length),
        operation: 'convert',
      }),
      'unsupported',
      id,
    );
  }
  for (const [id, from, to, operation] of [
    ['compress-m4a', 'm4a', 'm4a', 'compress'],
    ['compress-mp3', 'mp3', 'mp3', 'compress'],
    ['compress-mp4', 'mp4', 'mp4', 'compress'],
    ['m4a-to-mp3', 'm4a', 'mp3', 'convert'],
    ['mp3-to-m4a', 'mp3', 'm4a', 'convert'],
    ['mp4-to-m4a', 'mp4', 'm4a', 'convert'],
    ['mp4-to-mp3', 'mp4', 'mp3', 'convert'],
  ]) {
    assert.equal(
      getGenericSmokeExpectation({ id, from, to, operation }),
      'unsupported',
      id,
    );
  }
  assert.equal(
    getGenericSmokeExpectation({
      id: 'cr2-to-jpg',
      from: 'cr2',
      to: 'jpg',
      operation: 'convert',
    }),
    'unsupported',
  );
  assert.equal(
    getGenericSmokeExpectation({
      id: '3g2-to-mp4',
      from: '3g2',
      to: 'mp4',
      operation: 'convert',
    }),
    'unsupported',
  );
  assert.equal(
    getGenericSmokeExpectation({
      id: 'mp3-to-mp4',
      from: 'mp3',
      to: 'mp4',
      operation: 'convert',
    }),
    'unsupported',
  );
});

test('transcription smoke uses owned speech and a bounded success-or-error terminal', () => {
  const matrix = JSON.parse(
    readFileSync(
      new URL('../apps/tools/benchmarks/fixture-matrix.json', import.meta.url),
      'utf8',
    ),
  );
  const provenance = JSON.parse(
    readFileSync(
      new URL(
        '../apps/tools/benchmarks/fixture-provenance.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const relativeFixture = matrix.toolFixtures['audio-to-text']?.fixture;
  const fixture = readFileSync(
    new URL(`../apps/tools/benchmarks/${relativeFixture}`, import.meta.url),
  );

  assert.equal(relativeFixture, 'fixtures/transcription-speech.mp3');
  assert.equal(
    createHash('sha256').update(fixture).digest('hex'),
    provenance[relativeFixture].sha256,
  );
  assert.match(provenance[relativeFixture].command, /say -v Daniel/);
  assert.match(provenance[relativeFixture].command, /ffmpeg/);
  assert.match(provenance[relativeFixture].text, /shared workflow test/);
  assert.match(runnerSource, /toolFixtures\[tool\.id\]\?\.fixture/);
  assert.match(runnerSource, /readTranscriptionTerminalState/);
  assert.match(runnerSource, /timeout: 60_000/);
  assert.doesNotMatch(runnerSource, /timeout: 600000/);
});

test('local downloader smoke crosses the URL endpoint with checked-in media', () => {
  const matrix = JSON.parse(
    readFileSync(
      new URL('../apps/tools/benchmarks/fixture-matrix.json', import.meta.url),
      'utf8',
    ),
  );

  assert.deepEqual(matrix.toolFixtures['video-downloader'], {
    input: 'url',
    url: 'https://fixture.example/watch/deterministic-video',
    responseFixture: 'fixtures/sample.mp4',
  });
  assert.match(runnerSource, /tool\.id === ['"]video-downloader['"]/);
  assert.match(runnerSource, /page\.route\(['"]\*\*\/api\/media-fetch\*['"]/);
  assert.match(runnerSource, /data-status=['"]completed['"]/);
  assert.match(runnerSource, /data-status=['"]error['"]/);
});

test('specialized smoke coverage exercises rendered lifecycle and delivery behavior', () => {
  assert.match(runnerSource, /tool\.id === ['"]html-to-markdown['"]/);
  assert.match(
    runnerSource,
    /html clear allowed a scheduled result to reappear/i,
  );
  assert.match(runnerSource, /character debounce published stale statistics/i);
  assert.match(runnerSource, /csv-combiner-download/);
  assert.match(runnerSource, /__lastBlob/);
  assert.match(runnerSource, /__lastBlob\?\.text\(\)/);
  assert.match(runnerSource, /pdf-tool-input/);
  assert.match(runnerSource, /pdf-tool-viewer/);
  assert.match(runnerSource, /file=blob%3A/);
  assert.match(runnerSource, /pageerror/);
});

test('table smoke uses the table workflow seam and verifies CSV to JSON semantics', () => {
  assert.match(runnerSource, /tool\.id === ['"]csv-to-json['"]/);
  assert.match(runnerSource, /table-source-input/);
  assert.match(runnerSource, /table-convert-run/);
  assert.match(runnerSource, /table-output/);
  assert.match(runnerSource, /Ada/);
  assert.match(runnerSource, /Grace/);
  assert.match(runnerSource, /__lastBlob\?\.text\(\)/);
  assert.match(runnerSource, /JSON\.parse\(downloadedOutput\)/);
  assert.match(runnerSource, /assertCsvToJsonRecords/);
});

test('local evidence accepts only loopback targets', () => {
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--mode',
      'smoke',
      '--environment',
      'local',
      '--base-url',
      'https://tools.serp.co',
      '--revision',
      'a'.repeat(40),
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /sanitized target origin/i);
});

test('deployed browser evidence rejects dirty worktrees', () => {
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--mode',
      'benchmark',
      '--environment',
      'preview',
      '--base-url',
      'https://preview.example.test',
      '--revision',
      'a'.repeat(40),
      '--dirty',
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /dirty.*only.*local/i);
});

test('deployed evidence rejects loopback targets', () => {
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--mode',
      'smoke',
      '--environment',
      'preview',
      '--base-url',
      'https://localhost:3000',
      '--revision',
      'a'.repeat(40),
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /sanitized target origin/i);
});

test('browser initialization failure records structured evidence', (t) => {
  const { artifactRoot, result } = runLocalBrowserFixture(t, {
    envOverrides: {
      TOOLS_ONLY: 'character-counter',
      TOOLS_SERP_TEST_BROWSER_FAILURE: 'initialization',
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /structured failure artifact/i);
  const { manifest, summary } = readOnlyArtifactRun(artifactRoot);
  assert.equal(manifest.result.status, 'failure');
  assert.equal(manifest.scope.inputHashes.length, 1);
  assert.match(manifest.scope.label, /-subset$/);
  assert.match(summary, /items=1/);
});

test('empty browser selection records failure instead of successful evidence', (t) => {
  const { artifactRoot, result } = runLocalBrowserFixture(t, {
    mode: 'benchmark',
    envOverrides: { TOOLS_ONLY: 'not-a-registered-tool' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /selected no active Tools/i);
  const { manifest, summary } = readOnlyArtifactRun(artifactRoot);
  assert.equal(manifest.result.status, 'failure');
  assert.match(manifest.scope.label, /-subset$/);
  assert.match(summary, /items=0/);
});

test('browser limit must be a positive integer', (t) => {
  const { result } = runLocalBrowserFixture(t, {
    envOverrides: { TOOLS_LIMIT: '-1' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TOOLS_LIMIT.*positive integer/);
});

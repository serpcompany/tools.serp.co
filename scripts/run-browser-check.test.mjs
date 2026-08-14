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
const svgProofSource = readFileSync(
  new URL('./lib/svg-compression-browser-proof.mjs', import.meta.url),
  'utf8',
);
const genericWorkflowSource = readFileSync(
  new URL('../apps/tools/lib/generic-tool-workflow.ts', import.meta.url),
  'utf8',
);

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
  assert.equal(GENERIC_SMOKE_CAPABILITY_VERSION, 'generic-adapters-v7-tiff');
  assert.equal(
    getGenericSmokeExpectation({
      id: 'compress-svg',
      from: 'svg',
      to: 'svg',
      operation: 'compress',
    }),
    'supported',
  );
  assert.equal(
    getGenericSmokeExpectation({
      id: 'svg-to-png',
      from: 'svg',
      to: 'png',
      operation: 'convert',
    }),
    'unsupported',
  );
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
  for (const [id, to, operation] of [
    ['compress-webm', 'webm', 'compress'],
    ['webm-to-m4a', 'm4a', 'convert'],
    ['webm-to-mp3', 'mp3', 'convert'],
    ['webm-to-mp4', 'mp4', 'convert'],
  ]) {
    assert.equal(
      getGenericSmokeExpectation({ id, from: 'webm', to, operation }),
      'supported',
      id,
    );
  }
  assert.equal(
    getGenericSmokeExpectation({
      id: 'webm-to-mov',
      from: 'webm',
      to: 'mov',
      operation: 'convert',
    }),
    'unsupported',
  );
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

test('TIFF aliases require dedicated Worker and exact independent RGBA evidence', () => {
  for (const id of ['tif-to-png', 'tiff-to-png']) {
    assert.equal(
      getGenericSmokeExpectation({
        id,
        from: id.startsWith('tiff-') ? 'tiff' : 'tif',
        to: 'png',
        operation: 'convert',
      }),
      'supported',
    );
  }
  assert.equal(
    getGenericSmokeExpectation({
      id: 'tiff-to-jpg',
      from: 'tiff',
      to: 'jpg',
      operation: 'convert',
    }),
    'unsupported',
  );
  assert.match(genericWorkflowSource, /tiff-to-png\.worker/);
  assert.match(runnerSource, /rgbaSha256/);
  assert.match(runnerSource, /runTiffNegativePathProbe\(tool\.id\)/);
});

test('same-family MP4 to WebM browser proof independently decodes exact output', () => {
  assert.match(runnerSource, /tool\.id === 'mp4-to-webm'/);
  assert.match(runnerSource, /\[26, 69, 223, 163\]/);
  assert.match(runnerSource, /video\.videoWidth/);
  assert.match(runnerSource, /semantic-output/);
});

test('SVG compression proof uses its dedicated Worker and independent DOM plus two-viewport pixels', () => {
  assert.match(runnerSource, /tool\.id === 'compress-svg'/);
  assert.match(runnerSource, /proveSvgCompressionBrowser/);
  assert.match(svgProofSource, /workerUrls\.length !== 1/);
  assert.match(svgProofSource, /\/_next\/static\/chunks\//);
  assert.match(svgProofSource, /new DOMParser\(\)/);
  assert.match(svgProofSource, /attribute\.localName/);
  assert.match(svgProofSource, /attribute\.namespaceURI/);
  assert.match(svgProofSource, /new Image\(\)/);
  assert.match(svgProofSource, /URL\.revokeObjectURL/);
  assert.match(svgProofSource, /SVG_RENDER_VIEWPORTS/);
  assert.match(svgProofSource, /runNegativeProbe/);
  assert.match(svgProofSource, /compress-svg-success\.png/);
  assert.match(svgProofSource, /svg-compression-minimal\.svg/);
  assert.match(svgProofSource, /deterministic SVG output/);
  assert.match(svgProofSource, /SVG no-op output/);
});

test('Golden downloader and PNG to WebP checks retain exact or decoded fixture semantics', () => {
  assert.match(runnerSource, /assertExactFixtureBytes/);
  assert.match(runnerSource, /fixtureBytes/);
  assert.match(runnerSource, /outputSha256/);
  assert.match(runnerSource, /assertLossyUniformImageSummary/);
  assert.match(runnerSource, /tolerance: 8/);
  assert.match(runnerSource, /'image\/webp'/);
});

test('Golden output journeys retain exact negative-path probe checks', () => {
  assert.match(runnerSource, /function runGoldenNegativePathProbe/);
  for (const toolId of [
    'audio-to-text',
    'audio-to-transcript',
    'batch-compress-png',
    'bmp-to-png',
    'csv-to-json',
    'pdf-reader',
    'video-downloader',
  ]) {
    assert.match(runnerSource, new RegExp(`'${toolId}'`));
  }
  for (const check of [
    'malformed-input',
    'spoofed-input',
    'wrong-format-output',
    'no-delivery-on-failure',
    'cancellation-lifecycle',
  ]) {
    assert.match(runnerSource, new RegExp(`'${check}'`));
  }
  assert.match(runnerSource, /runGoldenNegativePathProbe\(tool\.id\)/);
});

test('truthfully unavailable compression retains no-delivery without claiming output semantics', () => {
  const unsupportedBranch = runnerSource.slice(
    runnerSource.indexOf(
      "detail: 'safe failure: published route is truthfully unsupported'",
    ),
    runnerSource.indexOf(
      'const blob = await waitForBlob',
      runnerSource.indexOf(
        "detail: 'safe failure: published route is truthfully unsupported'",
      ),
    ),
  );
  assert.match(unsupportedBranch, /no-delivery-on-failure/);
  assert.doesNotMatch(unsupportedBranch, /semantic-output/);
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
  assert.match(runnerSource, /fixture-provenance\.json/);
  assert.match(runnerSource, /assertTranscriptMatchesFixture/);
  assert.match(runnerSource, /toolFixtures\[tool\.id\]\?\.fixture/);
  assert.match(runnerSource, /readTranscriptionTerminalState/);
  assert.match(runnerSource, /timeout: 60_000/);
  assert.doesNotMatch(runnerSource, /timeout: 600000/);
  assert.match(
    runnerSource,
    /https:\/\/www\.youtube\.com\/watch\?v=3Is2P90qVa0/,
  );
  assert.match(
    runnerSource,
    /page\.fill\(['"]\[data-testid=[^\n]+tool-url-input/,
  );
  assert.match(runnerSource, /page\.route\(['"]\*\*\/api\/media-fetch\*['"]/);
  assert.match(runnerSource, /Download failed\|422\|Unexpected token/);
  assert.match(runnerSource, /dropFilesOnDropzone[\s\S]*fixtureEntry\.path/);
  assert.match(runnerSource, /getByTestId\(['"]tool-cancel['"]\)\.click\(\)/);
  assert.match(runnerSource, /No transcript was delivered\./);
  assert.match(runnerSource, /deliveriesBeforeCancellation/);
  assert.match(runnerSource, /'cancellation-lifecycle'/);
  assert.match(runnerSource, /https:\/\/media\.example\/direct-speech\.mp3/);
  assert.match(runnerSource, /direct-media transcript/);
  assert.match(
    runnerSource,
    /async function runFunctionalTest\(page, tool, result\)/,
  );
  assert.match(runnerSource, /runFunctionalTest\(page, tool, result\)/);
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
  assert.match(runnerSource, /data-page-number=[\\'"]1[\\'"]/);
  assert.match(runnerSource, /pageerror/);
  assert.match(runnerSource, /consoleWarnings/);
  assert.match(runnerSource, /message\.type\(\) === ['"]warning['"]/);
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

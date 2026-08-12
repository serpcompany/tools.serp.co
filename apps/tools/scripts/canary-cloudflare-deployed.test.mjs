import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const canaryScript = fileURLToPath(
  new URL('./canary-cloudflare-deployed.mjs', import.meta.url),
);
const canarySource = readFileSync(canaryScript, 'utf8');

function runCanary(arguments_) {
  return spawnSync(process.execPath, [canaryScript, ...arguments_], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INTERNAL_DASHBOARD_TOKEN: '',
    },
  });
}

test('deployed Cloudflare canary documents safe defaults and explicit opt-ins', () => {
  const result = runCanary(['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--environment <preview\|production>.*required/i);
  assert.match(result.stdout, /--revision <40-character-commit>.*required/i);
  assert.match(result.stdout, /safe reads by default/i);
  assert.match(result.stdout, /--allow-telemetry-write/);
  assert.match(result.stdout, /--include-native/);
  assert.match(result.stdout, /MEDIA_FETCH_CANARY_URL/);
  assert.match(result.stdout, /structured artifact/i);
  assert.doesNotMatch(
    result.stdout,
    /--internal-token|--report|--json|--no-fail/,
  );
});

test('deployed Cloudflare canary requires its target environment', () => {
  const result = runCanary([
    '--base-url',
    'https://preview.example.test',
    '--revision',
    'a'.repeat(40),
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /environment.*required/i);
});

test('deployed Cloudflare canary rejects unsafe base URLs before requests', () => {
  const result = runCanary([
    '--environment',
    'preview',
    '--base-url',
    'https://preview.example.test/?token=restricted',
    '--revision',
    'a'.repeat(40),
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /base-url.*query|base-url.*sanitized/i);
  assert.doesNotMatch(result.stderr, /restricted/);
});

test('deployed Cloudflare canary records structured target evidence', () => {
  assert.match(canarySource, /recordRunEvidence/);
  assert.match(canarySource, /command:\s*['"]canary:cloudflare:deployed['"]/);
  assert.match(
    canarySource,
    /args\.environment === ['"]production['"]\s*\?\s*['"]main['"]\s*:\s*['"]pull-request['"]/,
  );
  assert.match(canarySource, /scope:\s*`cloudflare-\$\{args\.environment\}`/);
  assert.match(canarySource, /linkedWork:\s*\[['"]#58['"]\]/);
});

test('native canaries require pure SVG success and structured unavailable contracts for native engines', () => {
  assert.match(
    canarySource,
    /POST \/api\/image-compress\?format=svg[\s\S]*response\.status === 200/,
  );
  for (const operation of ['image-convert', 'video-convert', 'pdf-compress']) {
    assert.match(
      canarySource,
      new RegExp(
        `isServerNativeUnavailable\\(response, bytes, "${operation}"\\)`,
      ),
    );
  }
  assert.match(canarySource, /payload\.code === "server-native-unavailable"/);
  assert.match(canarySource, /payload\.capability\?\.available === false/);
});

test('deployed Cloudflare canary verifies the emitted transcription chunk and FFmpeg resource contracts', () => {
  assert.match(canarySource, /validateCloudflareBuildProvenance/);
  assert.match(canarySource, /ffmpegWorkerChunkPath/);
  assert.match(canarySource, /transcriptionWorkerChunkPath/);
  assert.match(canarySource, /rev-parse/);
  assert.match(canarySource, /status.*--short/s);
  assert.match(canarySource, /cross-origin-embedder-policy/);
  assert.match(canarySource, /credentialless/);
  assert.match(canarySource, /cross-origin-resource-policy/);
  assert.match(canarySource, /same-origin/);
  assert.match(canarySource, /application\/wasm/);
  assert.match(canarySource, /text\/javascript/);
  assert.match(canarySource, /immutable/);
});

test('native canary setup failure records structured evidence', (t) => {
  const artifactRoot = mkdtempSync(
    path.join(tmpdir(), 'tools-serp-canary-failure-'),
  );
  t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      canaryScript,
      '--environment',
      'preview',
      '--base-url',
      'https://preview.example.test',
      '--revision',
      'a'.repeat(40),
      '--include-native',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        INTERNAL_DASHBOARD_TOKEN: '',
        NODE_ENV: 'test',
        TOOLS_SERP_TEST_CANARY_FAILURE: 'native-fixtures',
        TOOLS_SERP_TEST_REPOSITORY_ROOT: artifactRoot,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /structured failure artifact/i);
  const runNames = readdirSync(path.join(artifactRoot, '.artifacts', 'runs'));
  assert.equal(runNames.length, 1);
  const manifest = JSON.parse(
    readFileSync(
      path.join(
        artifactRoot,
        '.artifacts',
        'runs',
        runNames[0],
        'manifest.json',
      ),
      'utf8',
    ),
  );
  assert.equal(manifest.result.status, 'failure');
  assert.equal(manifest.scope.label, 'cloudflare-preview');
});

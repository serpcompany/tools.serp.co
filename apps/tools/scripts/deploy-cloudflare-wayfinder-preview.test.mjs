import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const deployScript = fileURLToPath(
  new URL('./deploy-cloudflare-wayfinder-preview.mjs', import.meta.url),
);
const deploySource = readFileSync(deployScript, 'utf8');

function writeExecutable(filePath, source) {
  writeFileSync(filePath, `#!/usr/bin/env node\n${source}`);
  chmodSync(filePath, 0o755);
}

test('preview dry run builds and validates the exact revision without upload', (t) => {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), 'tools-serp-wayfinder-preview-'),
  );
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const revision = '9d03c6db425946af8621fbf75f46e824884f2674';
  const capturePath = path.join(fixtureRoot, 'pnpm-calls.jsonl');
  const gitCapturePath = path.join(fixtureRoot, 'git-calls.jsonl');

  writeExecutable(
    path.join(fixtureRoot, 'git'),
    `
require('node:fs').appendFileSync(process.env.TEST_GIT_CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'rev-parse') process.stdout.write(process.env.TEST_REVISION);
else if (process.argv[2] === 'status') process.stdout.write('');
else process.exit(2);
`,
  );
  writeExecutable(
    path.join(fixtureRoot, 'pnpm'),
    `
const fs = require('node:fs');
fs.appendFileSync(process.env.TEST_CAPTURE, JSON.stringify({
  args: process.argv.slice(2),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  assetsUrl: process.env.NEXT_PUBLIC_ASSETS_BASE_URL,
}) + '\\n');
`,
  );

  const result = spawnSync(
    process.execPath,
    [deployScript, '--dry-run', '--', '--revision', revision],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        PATH: `${fixtureRoot}${path.delimiter}${process.env.PATH}`,
        TEST_CAPTURE: capturePath,
        TEST_GIT_CAPTURE: gitCapturePath,
        TEST_REVISION: revision,
        NODE_ENV: 'test',
        TOOLS_SERP_TEST_REPOSITORY_ROOT: fixtureRoot,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(capturePath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls, [
    {
      args: ['cf:build'],
      siteUrl:
        'https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev',
      assetsUrl: 'https://assets.tools.serp.co',
    },
    {
      args: [
        'exec',
        'wrangler',
        'deploy',
        '--env',
        'wayfinder-preview',
        '--var',
        `TOOLS_SERP_DEPLOYED_REVISION:${revision}`,
        '--dry-run',
      ],
      siteUrl:
        'https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev',
      assetsUrl: 'https://assets.tools.serp.co',
    },
  ]);
  assert.match(result.stdout, new RegExp(revision));
  assert.match(result.stdout, /dry run/i);
  const gitCalls = readFileSync(gitCapturePath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(gitCalls, [
    ['rev-parse', 'HEAD'],
    ['status', '--short'],
    ['status', '--short'],
  ]);
  const runNames = readdirSync(path.join(fixtureRoot, '.artifacts', 'runs'));
  assert.equal(runNames.length, 1);
  const manifest = JSON.parse(
    readFileSync(
      path.join(
        fixtureRoot,
        '.artifacts',
        'runs',
        runNames[0],
        'manifest.json',
      ),
      'utf8',
    ),
  );
  assert.equal(manifest.command.name, 'prepare:cloudflare:wayfinder-preview');
  assert.equal(manifest.revision.commit, revision);
  assert.equal(manifest.environment, 'local');
  assert.equal(manifest.scope.label, 'cloudflare-wayfinder-preview');
  assert.equal(manifest.result.status, 'success');
  assert.equal(existsSync(path.join(fixtureRoot, '.artifacts')), true);
});

test('preview wrapper reads deployment topology from Wrangler config', () => {
  assert.match(deploySource, /readFileSync\(wranglerConfigPath/);
  assert.doesNotMatch(
    deploySource,
    /const previewWorker = 'tools-serp-co-wayfinder-preview'/,
  );
  assert.doesNotMatch(
    deploySource,
    /const previewOrigin =\s*'https:\/\/tools-serp-co-wayfinder-preview/,
  );
});

test('preview deployment refuses to run when private Tool Factory bindings are missing', (t) => {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), 'tools-serp-wayfinder-access-'),
  );
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const revision = 'a'.repeat(40);

  writeExecutable(
    path.join(fixtureRoot, 'git'),
    `
if (process.argv[2] === 'rev-parse') process.stdout.write(process.env.TEST_REVISION);
else if (process.argv[2] === 'status') process.stdout.write('');
else process.exit(2);
`,
  );
  writeExecutable(
    path.join(fixtureRoot, 'pnpm'),
    `
if (process.argv.includes('secret') && process.argv.includes('list')) process.stdout.write('[]');
`,
  );

  const result = spawnSync(
    process.execPath,
    [deployScript, '--deploy', '--revision', revision],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        PATH: `${fixtureRoot}${path.delimiter}${process.env.PATH}`,
        TEST_REVISION: revision,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Tool Factory access secrets are incomplete/);
  assert.doesNotMatch(result.stderr, /ACCESS_AUD|ALLOWED_EMAIL|TEAM_DOMAIN/);
});

test('preview deployment names all required private access bindings without embedding values', () => {
  for (const name of [
    'TOOLS_SERP_CLOUDFLARE_ACCESS_TEAM_DOMAIN',
    'TOOLS_SERP_CLOUDFLARE_ACCESS_AUD',
    'TOOLS_SERP_TOOL_FACTORY_ALLOWED_EMAIL',
  ]) {
    assert.match(deploySource, new RegExp(`['"]${name}['"]`));
  }
  assert.doesNotMatch(deploySource, /@(?:gmail|serpcompany)\./i);
});

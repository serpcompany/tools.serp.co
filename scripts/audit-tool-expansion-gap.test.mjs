import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const command = fileURLToPath(
  new URL('./audit-tool-expansion-gap.mjs', import.meta.url),
);
const revision = 'd3e6c4c44af0d0a6a8e243f4a4e61963bb838e87';

function run(args) {
  return spawnSync(process.execPath, [command, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

test('CLI emits a report when its complete source graph is committed at the named revision', (t) => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tool-expansion-gap-cli-'),
  );
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const copy = spawnSync(
    'git',
    ['clone', '--quiet', repositoryRoot, fixtureRoot],
    { encoding: 'utf8' },
  );
  assert.equal(copy.status, 0, copy.stderr);
  fs.symlinkSync(
    path.join(repositoryRoot, 'node_modules'),
    path.join(fixtureRoot, 'node_modules'),
  );
  fs.symlinkSync(
    path.join(repositoryRoot, 'apps/tools/node_modules'),
    path.join(fixtureRoot, 'apps/tools/node_modules'),
  );
  for (const relativePath of [
    'scripts/audit-tool-expansion-gap.mjs',
    'scripts/lib/build-tool-expansion-gap.mjs',
    'scripts/lib/tool-expansion-gap-read-model.mjs',
    'scripts/lib/tool-expansion-gap-report.mjs',
  ]) {
    fs.copyFileSync(
      path.join(repositoryRoot, relativePath),
      path.join(fixtureRoot, relativePath),
    );
  }
  const staged = spawnSync('git', ['add', 'scripts'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });
  assert.equal(staged.status, 0, staged.stderr);
  const stagedDiff = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: fixtureRoot,
  });
  if (stagedDiff.status === 1) {
    const committed = spawnSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      {
        cwd: fixtureRoot,
        encoding: 'utf8',
      },
    );
    assert.equal(committed.status, 0, committed.stderr);
  } else {
    assert.equal(stagedDiff.status, 0, stagedDiff.stderr);
  }
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  }).stdout.trim();
  const result = spawnSync(
    process.execPath,
    [
      'scripts/audit-tool-expansion-gap.mjs',
      '--source-revision',
      commit,
      '--format',
      'report',
    ],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2,807 active Tool ids/);
  assert.match(result.stdout, /sha256:fadb77ac/);
});

test('CLI rejects partial revisions and unsupported output formats', () => {
  const partial = run([
    '--source-revision',
    revision.slice(0, 8),
    '--format',
    'json',
  ]);
  assert.notEqual(partial.status, 0);
  assert.match(partial.stderr, /full 40-character commit/);

  const invalidFormat = run([
    '--source-revision',
    revision,
    '--format',
    'html',
  ]);
  assert.notEqual(invalidFormat.status, 0);
  assert.match(invalidFormat.stderr, /--format must be json or report/);
});

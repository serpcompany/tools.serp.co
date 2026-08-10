import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(
  new URL('./run-with-scratch.mjs', import.meta.url),
);

function createTemporaryRoot(testContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'tools-serp-scratch-test-'));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runWithScratch(temporaryRoot, commandArguments) {
  return spawnSync(process.execPath, [cliPath, '--', ...commandArguments], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TMPDIR: temporaryRoot,
      TMP: temporaryRoot,
      TEMP: temporaryRoot,
    },
  });
}

test('scratch runner removes its command-owned directory on exit', (t) => {
  const temporaryRoot = createTemporaryRoot(t);
  const probe = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const scratch = process.env.TOOLS_SERP_SCRATCH_DIR;',
    "fs.writeFileSync(path.join(scratch, 'probe.txt'), 'temporary');",
    'process.stdout.write(scratch);',
  ].join(' ');

  const result = runWithScratch(temporaryRoot, [process.execPath, '-e', probe]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tools-serp-scratch[\\/]run-/);
  assert.equal(existsSync(result.stdout), false);
});

test('scratch runner expires only abandoned owned directories after 24 hours', (t) => {
  const temporaryRoot = createTemporaryRoot(t);
  const ownedRoot = path.join(temporaryRoot, 'tools-serp-scratch');
  const staleRoot = path.join(ownedRoot, 'run-stale');
  const recentRoot = path.join(ownedRoot, 'run-recent');
  mkdirSync(staleRoot, { recursive: true });
  mkdirSync(recentRoot);
  writeFileSync(
    path.join(staleRoot, '.owner.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      pid: 99_999_999,
      createdAt: '2000-01-01T00:00:00.000Z',
    })}\n`,
  );
  writeFileSync(
    path.join(recentRoot, '.owner.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      pid: 99_999_999,
      createdAt: '2999-01-01T00:00:00.000Z',
    })}\n`,
  );

  const result = runWithScratch(temporaryRoot, [process.execPath, '-e', '']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(staleRoot), false);
  assert.equal(existsSync(recentRoot), true);
});

test('scratch runner expires old run directories with missing ownership', (t) => {
  const temporaryRoot = createTemporaryRoot(t);
  const abandonedRoot = path.join(
    temporaryRoot,
    'tools-serp-scratch',
    'run-abandoned',
  );
  mkdirSync(abandonedRoot, { recursive: true });
  const oldTimestamp = new Date('2000-01-01T00:00:00.000Z');
  utimesSync(abandonedRoot, oldTimestamp, oldTimestamp);

  const result = runWithScratch(temporaryRoot, [process.execPath, '-e', '']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(abandonedRoot), false);
});

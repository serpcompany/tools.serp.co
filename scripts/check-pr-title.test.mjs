import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isValidPrTitle } from './check-pr-title.mjs';

const scriptPath = fileURLToPath(new URL('./check-pr-title.mjs', import.meta.url));

const VALID = [
  'feat: noindex non-production and redirect platform hosts',
  'fix: validate and bound D1 telemetry writes',
  'chore: restart foundation from main with cherry-picked cleanup',
  'ci: run a browser smoke test against a freshly migrated Worker',
  'fix(telemetry): bound writes',
  'fix(apps/tools): x',
  'feat(UI): x',
  'fix(api,ui): x',
  'ci!: drop node 20',
  'refactor(core)!: rename the catalog',
  'chore(main): release 1.2.0',
  'Revert "fix: validate and bound D1 telemetry writes"',
];

const INVALID = [
  'Feat: x',
  'update stuff',
  'fix:missing space',
  'fix:  two spaces',
  'docs: ',
  'fix : x',
  'fix(): empty scope',
  'fix()!: x',
  'fix!(scope): x',
  'revert: x',
  'Revert fix: x',
  '',
];

test('accepts Conventional Commit titles and GitHub revert titles', () => {
  for (const title of VALID) {
    assert.equal(isValidPrTitle(title), true, title);
  }
});

test('rejects titles that are not Conventional Commits', () => {
  for (const title of INVALID) {
    assert.equal(isValidPrTitle(title), false, JSON.stringify(title));
  }
});

test('the CLI exits 1 with a workflow error for a bad title', () => {
  const bad = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, TITLE: 'update stuff' },
    encoding: 'utf8',
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^::error::PR title must look like/);

  const good = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, TITLE: 'fix: x' },
    encoding: 'utf8',
  });
  assert.equal(good.status, 0, good.stdout);
});

test('the CLI still checks the title when run through a symlink', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr-title-'));
  const link = path.join(dir, 'check-pr-title.mjs');
  symlinkSync(scriptPath, link);
  try {
    const bad = spawnSync(process.execPath, [link], {
      env: { ...process.env, TITLE: 'update stuff' },
      encoding: 'utf8',
    });
    assert.equal(bad.status, 1, bad.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

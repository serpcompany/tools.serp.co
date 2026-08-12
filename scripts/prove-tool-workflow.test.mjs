import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

test('public proof command documents exact revisions and its honest evidence limits', () => {
  assert.equal(
    packageJson.scripts['proof:tool-workflow'],
    'node scripts/prove-tool-workflow.mjs',
  );
  const runbook = readFileSync('docs/runbooks/commands.md', 'utf8');
  assert.match(
    runbook,
    /pnpm proof:tool-workflow -- --baseline <full-commit-sha> --current <full-commit-sha>/,
  );
  assert.match(runbook, /same evaluator/i);
  assert.match(runbook, /15\.18%/);
  assert.match(runbook, /deployed behavior.*unproven/i);
});

test('CLI help exposes the fixed historical default without silently applying it', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/prove-tool-workflow.mjs', '--help'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--baseline <full-commit-sha>/);
  assert.match(
    result.stdout,
    /d4499e333450f5bc501e3842d37deb029717aef4/,
  );
  assert.match(result.stdout, /both arguments are required/i);
});

test('pnpm argument separator reaches the CLI without changing the public seam', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/prove-tool-workflow.mjs', '--', '--baseline', 'bad', '--current', 'bad'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /supported Node 22 runtime|full 40-character Git commit|consumed current proof inputs must be clean/i,
  );
  assert.doesNotMatch(result.stderr, /^Usage:/);
});

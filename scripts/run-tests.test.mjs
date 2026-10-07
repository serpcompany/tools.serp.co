import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('./run-tests.mjs', import.meta.url));
const repositoryPackagePath = fileURLToPath(
  new URL('../package.json', import.meta.url),
);

// A git hook exports GIT_DIR (and in a linked worktree, more GIT_* variables).
// Inherited, they point the fixture's git commands at the real repository's
// index, so fixture processes run without them.
const fixtureEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

function writeFixtureFile(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function stageFixtureChanges(root) {
  const result = spawnSync('git', ['add', '--all'], {
    cwd: root,
    encoding: 'utf8',
    env: fixtureEnv,
  });
  assert.equal(result.status, 0, result.stderr);
}

function createRepositoryFixture(testContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'tools-serp-test-suite-'));
  const passingTest = [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    '',
    "test('fixture passes', () => assert.equal(2 + 2, 4));",
    '',
  ].join('\n');

  writeFixtureFile(root, 'apps/demo/lib/passes.test.mjs', passingTest);
  writeFixtureFile(root, 'packages/widget/src/passes.test.mjs', passingTest);
  writeFixtureFile(
    root,
    'scripts/not-a-test.mjs',
    'export const answer = 42;\n',
  );

  const initResult = spawnSync('git', ['init', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
    env: fixtureEnv,
  });
  assert.equal(initResult.status, 0, initResult.stderr);

  stageFixtureChanges(root);

  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runTestSuite(root) {
  const env = { ...fixtureEnv };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [runnerPath, '--root', root], {
    encoding: 'utf8',
    env,
  });
}

test('root package exposes the canonical deterministic test command', () => {
  const packageJson = JSON.parse(readFileSync(repositoryPackagePath, 'utf8'));

  assert.equal(packageJson.scripts.test, 'node scripts/run-tests.mjs');
});

test('runner executes every committed test in ownership-labelled groups', (t) => {
  const root = createRepositoryFixture(t);
  const result = runTestSuite(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /test-discovery: 2 committed node:test files/);
  assert.match(result.stdout, /\[test:app:demo\] 1 file/);
  assert.match(result.stdout, /\[test:package:widget\] 1 file/);
  assert.doesNotMatch(result.stdout, /not-a-test\.mjs/);
});

test('runner rejects committed node:test imports outside the test naming contract', (t) => {
  const root = createRepositoryFixture(t);
  writeFixtureFile(
    root,
    'scripts/misplaced.mjs',
    "import test from 'node:test';\ntest('misplaced', () => {});\n",
  );
  stageFixtureChanges(root);

  const result = runTestSuite(root);

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(
    result.stderr,
    /test-discovery-error: scripts\/misplaced\.mjs imports node:test but is not named \*\.test\.<js extension>/,
  );
});

test('runner rejects test-named files that are not node:test entrypoints', (t) => {
  const root = createRepositoryFixture(t);
  writeFixtureFile(
    root,
    'apps/demo/lib/not-really.test.mjs',
    'export const helper = true;\n',
  );
  stageFixtureChanges(root);

  const result = runTestSuite(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /test-discovery-error: apps\/demo\/lib\/not-really\.test\.mjs is named like a test but does not import node:test/,
  );
});

test('runner does not treat commented node:test text as an import', (t) => {
  const root = createRepositoryFixture(t);
  writeFixtureFile(
    root,
    'apps/demo/lib/comment-only.test.mjs',
    "// import test from 'node:test';\nexport const helper = true;\n",
  );
  stageFixtureChanges(root);

  const result = runTestSuite(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /test-discovery-error: apps\/demo\/lib\/comment-only\.test\.mjs is named like a test but does not import node:test/,
  );
});

test('runner keeps ownership context when one group fails', (t) => {
  const root = createRepositoryFixture(t);
  writeFixtureFile(
    root,
    'packages/widget/src/passes.test.mjs',
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      '',
      "test('package-owned failure', () => assert.fail('fixture failure'));",
      '',
    ].join('\n'),
  );
  stageFixtureChanges(root);

  const result = runTestSuite(root);

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /\[test:app:demo\] 1 file/);
  assert.match(result.stdout, /\[test:package:widget\] 1 file/);
  assert.match(result.stdout, /package-owned failure/);
});

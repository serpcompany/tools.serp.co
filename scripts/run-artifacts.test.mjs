import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('./run-artifacts.mjs', import.meta.url));
const fullRevision = 'abcdef1234567890abcdef1234567890abcdef12';

function createRepositoryFixture(testContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'tools-serp-artifacts-'));
  mkdirSync(path.join(root, '.artifacts', 'runs'), { recursive: true });
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function createEmptyRepositoryFixture(testContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'tools-serp-artifacts-empty-'));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeRun(root, runId, overrides = {}) {
  const runRoot = path.join(root, '.artifacts', 'runs', runId);
  mkdirSync(runRoot, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    runId,
    command: { name: 'smoke:tools', version: '1' },
    revision: { commit: 'abcdef1', dirty: false },
    timestamps: {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:05:00.000Z',
    },
    environment: 'local',
    scope: { label: 'all-tools', inputHashes: [] },
    result: { status: 'success' },
    runtime: { node: '20.19.0', pnpm: '10.4.1', platform: 'darwin-arm64' },
    classification: 'internal',
    expiresAt: '2026-01-08T00:05:00.000Z',
    linkedWork: ['#57'],
    ...overrides,
  };
  writeFileSync(
    path.join(runRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(path.join(runRoot, 'summary.txt'), 'safe summary\n');
  return runRoot;
}

function runCleanup(root, args = []) {
  return spawnSync(
    process.execPath,
    [cliPath, 'cleanup', '--repository-root', root, ...args],
    { encoding: 'utf8' },
  );
}

function createRun(root, args = [], input) {
  return spawnSync(
    process.execPath,
    [cliPath, 'create', '--repository-root', root, ...args],
    { encoding: 'utf8', input },
  );
}

function createArguments(overrides = {}) {
  const values = {
    command: 'smoke:tools',
    commandVersion: '1',
    revision: fullRevision,
    environment: 'local',
    scope: 'all-tools',
    status: 'success',
    classification: 'internal',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    inputHashes: [],
    linkedWork: [],
    tools: [],
    ...overrides,
  };
  const arguments_ = [
    '--command',
    values.command,
    '--command-version',
    values.commandVersion,
    '--revision',
    values.revision,
    '--environment',
    values.environment,
    '--scope',
    values.scope,
    '--status',
    values.status,
    '--classification',
    values.classification,
    '--started-at',
    values.startedAt,
    '--completed-at',
    values.completedAt,
  ];
  for (const inputHash of values.inputHashes) {
    arguments_.push('--input-hash', inputHash);
  }
  for (const linkedWork of values.linkedWork) {
    arguments_.push('--linked-work', linkedWork);
  }
  for (const tool of values.tools) {
    arguments_.push('--tool-evidence', JSON.stringify(tool));
  }
  if (values.retentionClass !== undefined) {
    arguments_.push('--retention-class', values.retentionClass);
  }
  if (values.dirty === true) {
    arguments_.push('--dirty');
  }
  if (values.summaryStdin === true) {
    arguments_.push('--summary-stdin');
  }
  return arguments_;
}

test('artifact cleanup is dry-run by default', (t) => {
  const root = createRepositoryFixture(t);
  const runId = '20260101T000000Z_abcdef1_local_all-tools';
  const runRoot = writeRun(root, runId);

  const result = runCleanup(root, ['--now', '2026-02-01T00:00:00.000Z']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`would-delete ${runId} \\d+ bytes`));
  assert.match(result.stdout, /dry-run: 1 artifact, \d+ bytes/);
  assert.equal(existsSync(runRoot), true);
});

test('artifact cleanup is an empty dry-run before artifacts exist', (t) => {
  const root = createEmptyRepositoryFixture(t);

  const result = runCleanup(root);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'dry-run: 0 artifacts, 0 bytes\n');
  assert.equal(existsSync(path.join(root, '.artifacts')), false);
});

test('artifact cleanup deletes selected runs only with --apply', (t) => {
  const root = createRepositoryFixture(t);
  const runId = '20260101T000000Z_abcdef1_local_all-tools';
  const runRoot = writeRun(root, runId);

  const result = runCleanup(root, [
    '--now',
    '2026-02-01T00:00:00.000Z',
    '--apply',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`deleted ${runId} \\d+ bytes`));
  assert.match(result.stdout, /applied: 1 artifact, \d+ bytes/);
  assert.equal(existsSync(runRoot), false);
});

test('artifact cleanup filters runs by age', (t) => {
  const root = createRepositoryFixture(t);
  const oldRun = '20260101T000000Z_abcdef1_local_old';
  const recentRun = '20260128T000000Z_abcdef1_local_recent';
  writeRun(root, oldRun, {
    timestamps: {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:05:00.000Z',
    },
    expiresAt: '2027-01-01T00:00:00.000Z',
  });
  writeRun(root, recentRun, {
    timestamps: {
      startedAt: '2026-01-28T00:00:00.000Z',
      completedAt: '2026-01-28T00:05:00.000Z',
    },
    expiresAt: '2026-01-29T00:00:00.000Z',
  });

  const result = runCleanup(root, [
    '--now',
    '2026-02-01T00:00:00.000Z',
    '--older-than-days',
    '14',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`would-delete ${oldRun} \\d+ bytes`));
  assert.doesNotMatch(result.stdout, new RegExp(recentRun));
  assert.match(result.stdout, /dry-run: 1 artifact, \d+ bytes/);
});

test('artifact cleanup filters runs by command', (t) => {
  const root = createRepositoryFixture(t);
  const smokeRun = '20260101T000000Z_abcdef1_local_smoke';
  const benchmarkRun = '20260101T000000Z_abcdef1_local_benchmark';
  writeRun(root, smokeRun);
  writeRun(root, benchmarkRun, {
    command: { name: 'benchmark:tools', version: '1' },
  });

  const result = runCleanup(root, [
    '--now',
    '2026-02-01T00:00:00.000Z',
    '--command',
    'benchmark:tools',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`would-delete ${benchmarkRun} \\d+ bytes`),
  );
  assert.doesNotMatch(result.stdout, new RegExp(smokeRun));
  assert.match(result.stdout, /dry-run: 1 artifact, \d+ bytes/);
});

test('artifact cleanup rejects symlinks inside selected runs', (t) => {
  const root = createRepositoryFixture(t);
  const runId = '20260101T000000Z_abcdef1_local_linked';
  const runRoot = writeRun(root, runId);
  const outsideFile = path.join(root, 'outside.txt');
  writeFileSync(outsideFile, 'must remain\n');
  symlinkSync(outsideFile, path.join(runRoot, 'linked.txt'));

  const result = runCleanup(root, [
    '--now',
    '2026-02-01T00:00:00.000Z',
    '--apply',
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing symlink/i);
  assert.equal(existsSync(runRoot), true);
  assert.equal(existsSync(outsideFile), true);
});

test('artifact cleanup rejects a symlinked manifest before filtering', (t) => {
  const root = createRepositoryFixture(t);
  const runId = '20260101T000000Z_abcdef1_local_unselected-link';
  const runRoot = writeRun(root, runId);
  const externalManifest = path.join(root, 'external-manifest.json');
  writeFileSync(
    externalManifest,
    `${JSON.stringify({
      expiresAt: '2999-01-01T00:00:00.000Z',
      timestamps: { completedAt: '2999-01-01T00:00:00.000Z' },
      command: { name: 'smoke:tools' },
    })}\n`,
  );
  rmSync(path.join(runRoot, 'manifest.json'));
  symlinkSync(externalManifest, path.join(runRoot, 'manifest.json'));

  const result = runCleanup(root, ['--now', '2026-02-01T00:00:00.000Z']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing symlink.*manifest\.json/i);
  assert.equal(existsSync(runRoot), true);
});

test('artifact cleanup rejects symlinked run entries', (t) => {
  const root = createRepositoryFixture(t);
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'tools-serp-run-link-'));
  t.after(() => rmSync(outsideRoot, { recursive: true, force: true }));
  symlinkSync(outsideRoot, path.join(root, '.artifacts', 'runs', 'linked-run'));

  const result = runCleanup(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing symlinked run/i);
  assert.equal(existsSync(outsideRoot), true);
});

test('artifact cleanup rejects an owned root that escapes through a symlink', (t) => {
  const root = createRepositoryFixture(t);
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'tools-serp-outside-'));
  t.after(() => rmSync(outsideRoot, { recursive: true, force: true }));
  const runId = '20260101T000000Z_abcdef1_local_escape';
  writeRun(outsideRoot, runId);

  const ownedRoot = path.join(root, '.artifacts', 'runs');
  rmSync(ownedRoot, { recursive: true });
  symlinkSync(path.join(outsideRoot, '.artifacts', 'runs'), ownedRoot);

  const result = runCleanup(root, [
    '--now',
    '2026-02-01T00:00:00.000Z',
    '--apply',
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /artifact root.*symlink|outside repository/i);
  assert.equal(
    existsSync(path.join(outsideRoot, '.artifacts', 'runs', runId)),
    true,
  );
});

test('artifact creation writes the accepted run identity and manifest', (t) => {
  const root = createRepositoryFixture(t);
  const inputHash = `sha256:${'a'.repeat(64)}`;

  const result = createRun(
    root,
    createArguments({
      inputHashes: [inputHash],
      linkedWork: ['#57'],
      tools: [
        {
          toolId: 'png-to-webp',
          invariants: ['generic-file-exact-output'],
          warnings: ['adsense-script-attribute'],
        },
        {
          toolId: 'video-downloader',
          invariants: ['url-stream-exact-output'],
        },
      ],
    }),
  );

  const runId = '20260101T000000Z_abcdef1_local_all-tools';
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `created ${runId}\n`);
  const manifest = JSON.parse(
    readFileSync(
      path.join(root, '.artifacts', 'runs', runId, 'manifest.json'),
      'utf8',
    ),
  );
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    runId,
    command: { name: 'smoke:tools', version: '1' },
    revision: { commit: fullRevision, dirty: false },
    timestamps: {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:05:00.000Z',
    },
    environment: 'local',
    scope: {
      label: 'all-tools',
      inputHashes: [inputHash],
      tools: [
        {
          toolId: 'png-to-webp',
          invariants: ['generic-file-exact-output'],
          warnings: ['adsense-script-attribute'],
        },
        {
          toolId: 'video-downloader',
          invariants: ['url-stream-exact-output'],
        },
      ],
    },
    result: { status: 'success' },
    runtime: {
      node: process.versions.node,
      pnpm: '10.4.1',
      platform: `${process.platform}-${process.arch}`,
    },
    classification: 'internal',
    retentionClass: 'local-debug',
    expiresAt: '2026-01-08T00:05:00.000Z',
    linkedWork: ['#57'],
  });
});

test('artifact creation requires the full Git revision', (t) => {
  const root = createRepositoryFixture(t);

  const result = createRun(
    root,
    createArguments({ revision: fullRevision.slice(0, 7) }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /revision.*full 40-character/i);
  assert.deepEqual(readdirSync(path.join(root, '.artifacts', 'runs')), []);
});

test('artifact creation removes fractional seconds from the run identity', (t) => {
  const root = createRepositoryFixture(t);

  const result = createRun(
    root,
    createArguments({ startedAt: '2026-01-01T00:00:00.123Z' }),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    'created 20260101T000000Z_abcdef1_local_all-tools\n',
  );
});

test('artifact creation redacts restricted report values before writing', (t) => {
  const root = createRepositoryFixture(t);
  const result = createRun(
    root,
    createArguments({ status: 'failure', summaryStdin: true }),
    [
      'status=failure',
      'Authorization: Bearer top-secret-token',
      'password=hunter2',
      'request=https://api.example.test/file?X-Amz-Signature=signed-value',
      'source=/Users/alice/private/customer-list.csv',
      'email=alice@example.com',
      'user_id=customer-123',
      'production_row={"email":"alice@example.com","value":42}',
      'Bearer standalone-authorization-value',
      'X-Amz-Signature=standalone-signed-value',
      'DATABASE_URL=postgres://db-user:db-password@db.example/prod',
      'sensitive-customer-file.csv',
      '',
    ].join('\n'),
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = readFileSync(
    path.join(
      root,
      '.artifacts',
      'runs',
      '20260101T000000Z_abcdef1_local_all-tools',
      'summary.txt',
    ),
    'utf8',
  );
  assert.match(summary, /status=failure/);
  assert.match(summary, /\[authorization-redacted\]/);
  assert.match(summary, /\[credential-redacted\]/);
  assert.match(summary, /\[url-redacted\]/);
  assert.match(summary, /\[sensitive-filename-redacted\]/);
  assert.match(summary, /\[personal-identifier-redacted\]/);
  assert.match(summary, /\[production-row-redacted\]/);
  for (const restrictedValue of [
    'top-secret-token',
    'hunter2',
    'signed-value',
    '/Users/alice',
    'customer-list.csv',
    'alice@example.com',
    'customer-123',
    'standalone-authorization-value',
    'standalone-signed-value',
    'db-password',
    'sensitive-customer-file.csv',
  ]) {
    assert.doesNotMatch(summary, new RegExp(restrictedValue));
  }
});

test('artifact creation applies accepted retention defaults', (t) => {
  const root = createRepositoryFixture(t);
  const cases = [
    ['local', undefined, 'local-debug', 7],
    ['local', 'retained-debug', 'retained-debug', 14],
    ['pull-request', undefined, 'pull-request', 14],
    ['scheduled', undefined, 'scheduled', 30],
    ['main', undefined, 'main', 30],
    ['migration', undefined, 'migration', 7],
  ];

  for (const [
    environment,
    requestedClass,
    expectedClass,
    retentionDays,
  ] of cases) {
    const scope = requestedClass ?? environment;
    const result = createRun(
      root,
      createArguments({
        environment,
        scope,
        retentionClass: requestedClass,
      }),
    );

    assert.equal(result.status, 0, result.stderr);
    const runId = result.stdout.trim().replace(/^created /, '');
    const manifest = JSON.parse(
      readFileSync(
        path.join(root, '.artifacts', 'runs', runId, 'manifest.json'),
        'utf8',
      ),
    );
    assert.equal(manifest.retentionClass, expectedClass);
    assert.equal(
      manifest.expiresAt,
      new Date(
        Date.parse('2026-01-01T00:05:00.000Z') +
          retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
  }
});

test('artifact creation never retains credential-bearing material', (t) => {
  const root = createRepositoryFixture(t);

  const result = createRun(
    root,
    createArguments({ status: 'failure', classification: 'credential' }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /credential.*never.*retained/i);
  assert.deepEqual(readdirSync(path.join(root, '.artifacts', 'runs')), []);
});

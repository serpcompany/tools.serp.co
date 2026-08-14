import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildToolVerificationInputs,
  compatibleExecutableSourcesRevision,
  isToolExecutableVerificationInput,
  verifyExecutableHashScopeMigration,
} from './generate-tool-verification-inputs.mjs';

test('execution evidence excludes capability projections but includes real processors and workers', () => {
  assert.equal(
    isToolExecutableVerificationInput(
      'apps/tools/app/internal/tools/tool-factory-table.tsx',
    ),
    false,
  );
  assert.equal(
    isToolExecutableVerificationInput(
      'apps/tools/lib/tool-acceptance-claims.ts',
    ),
    false,
  );
  assert.equal(
    isToolExecutableVerificationInput(
      'apps/tools/lib/tool-factory-read-model.ts',
    ),
    false,
  );
  assert.equal(
    isToolExecutableVerificationInput(
      'apps/tools/lib/tool-factory-source-view.ts',
    ),
    false,
  );
  assert.equal(
    isToolExecutableVerificationInput(
      'apps/tools/lib/tool-factory-summary.ts',
    ),
    false,
  );
  assert.equal(
    isToolExecutableVerificationInput(
      'apps/tools/lib/generic-tool-workflow.ts',
    ),
    true,
  );
  assert.equal(
    isToolExecutableVerificationInput('apps/tools/workers/convert.worker.ts'),
    true,
  );
});

test('hash-scope migration preserves exact retained evidence only at the transition digest', () => {
  const migration = verifyExecutableHashScopeMigration();
  assert.equal(migration.id, 'exclude-capability-projections-v1');
  assert.equal(
    migration.baselineRevision,
    '714dd1b0d5923ea5f8a88377a4b4036781542a77',
  );
  assert.equal(
    compatibleExecutableSourcesRevision(
      '659ba75a2108130167b9548443c445abd2e2f8bb046ae2581839f36da5ee7122',
      migration,
    ),
    'sha256:6a3479acce25ce3ddb69eb692bcd25dff7ab3a40a62eb93184e3c72dc105aa4e',
  );
  assert.equal(
    compatibleExecutableSourcesRevision('f'.repeat(64), migration),
    `sha256:${'f'.repeat(64)}`,
  );
  assert.throws(
    () => compatibleExecutableSourcesRevision('not-a-digest', migration),
    /must be a SHA-256 digest/i,
  );
});

test('repository check retains the baseline history required by the scope migration', () => {
  const workflow = readFileSync(
    path.resolve('.github/workflows/check.yml'),
    'utf8',
  );
  assert.match(
    workflow,
    /uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 0/,
  );
});

test('verification input manifest is mechanically generated from source, dependencies, runner, and fixture bytes', () => {
  const retained = JSON.parse(
    readFileSync(
      path.resolve('apps/tools/lib/tool-verification-inputs.generated.json'),
      'utf8',
    ),
  );
  assert.deepEqual(retained, buildToolVerificationInputs());
  assert.match(
    retained.fixtureSha256ByJourney['png-to-webp:upload'],
    /^[a-f0-9]{64}$/,
  );
});

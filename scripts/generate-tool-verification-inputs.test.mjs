import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildToolVerificationInputs,
  isToolExecutableVerificationInput,
} from './generate-tool-verification-inputs.mjs';

test('execution evidence excludes capability projections but includes real processors and workers', () => {
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
      'apps/tools/lib/generic-tool-workflow.ts',
    ),
    true,
  );
  assert.equal(
    isToolExecutableVerificationInput('apps/tools/workers/convert.worker.ts'),
    true,
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

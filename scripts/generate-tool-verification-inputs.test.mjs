import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildToolVerificationInputs } from './generate-tool-verification-inputs.mjs';

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

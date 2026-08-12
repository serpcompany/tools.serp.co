import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./audit-tool-coverage.mjs', import.meta.url),
  'utf8',
);

test('revision validation pins the reproducer and its local classification dependency', () => {
  assert.match(
    source,
    /const auditReproducerInputs = collectLocalModuleInputs\([\s\S]*['"]scripts\/audit-tool-coverage\.mjs['"]/,
  );
  assert.match(source, /source\.matchAll\(importPattern\)/);
  assert.match(source, /from\\s\*\|import\\s\*\\\(/);
  assert.match(
    source,
    /const auditedInputPaths = \[[\s\S]*\.\.\.auditReproducerInputs/,
  );
  assert.match(
    source,
    /git[\s\S]*diff[\s\S]*sourceRevision[\s\S]*\.\.\.auditedInputPaths/,
  );
});

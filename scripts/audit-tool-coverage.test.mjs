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

test('audit payload identifies the exact runtime command, timestamp, and environment', () => {
  assert.doesNotMatch(source, /auditDate:\s*['"]2026-08-11['"]/);
  assert.match(source, /generatedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(source, /command:\s*Object\.freeze/);
  assert.match(source, /node:\s*process\.versions\.node/);
  assert.match(
    source,
    /platform:\s*`\$\{process\.platform\}-\$\{process\.arch\}`/,
  );
});

test('audit consumes canonical acceptance claims including reasons and memberships', () => {
  assert.match(source, /claims:\s*toolAcceptanceClaims\.all/);
  assert.match(source, /memberships:\s*toolAcceptanceClaims\.memberships/);
  assert.match(source, /claims:\s*acceptanceClassification\.claims/);
});

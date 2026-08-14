import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const allowedClassifications = new Set([
  'fixture',
  'generated projection',
  'dated advisory evidence',
  'obsolete input',
]);

function trackedCsvPaths() {
  const result = spawnSync('git', ['ls-files', '*.csv'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean).sort();
}

function classifiedCsvPaths() {
  const source = readFileSync('docs/evidence/README.md', 'utf8');
  const entries = [];
  const rowPattern = /^\|\s+`([^`]+\.csv)`\s+\|\s+`([^`]+)`\s+\|/gm;
  let match;
  while ((match = rowPattern.exec(source)) !== null) {
    entries.push({ path: match[1], classification: match[2] });
  }
  return entries;
}

test('every tracked CSV has exactly one explicit source classification', () => {
  const entries = classifiedCsvPaths();
  const classifiedPaths = entries.map((entry) => entry.path).sort();

  assert.deepEqual(classifiedPaths, [...new Set(classifiedPaths)]);
  assert.deepEqual(classifiedPaths, trackedCsvPaths());
  assert.ok(
    entries.every((entry) => allowedClassifications.has(entry.classification)),
  );
});

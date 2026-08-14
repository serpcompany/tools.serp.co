import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  allowedCsvSourceClassifications,
  parseCsvSourceClassifications,
} from './lib/csv-source-classification.mjs';

function trackedCsvPaths() {
  const result = spawnSync('git', ['ls-files', '*.csv'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean).sort();
}

function classifiedCsvPaths() {
  const source = readFileSync('docs/evidence/README.md', 'utf8');
  return parseCsvSourceClassifications(source);
}

test('every tracked CSV has exactly one explicit source classification', () => {
  const entries = classifiedCsvPaths();
  const classifiedPaths = entries.map((entry) => entry.path).sort();

  assert.deepEqual(classifiedPaths, [...new Set(classifiedPaths)]);
  assert.deepEqual(classifiedPaths, trackedCsvPaths());
  assert.ok(
    entries.every((entry) =>
      allowedCsvSourceClassifications.has(entry.classification),
    ),
  );
});

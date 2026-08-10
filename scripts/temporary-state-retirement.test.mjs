import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseArgs } from '../apps/tools/scripts/import-tool-runs-to-d1.mjs';

function scriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return scriptFiles(entryPath);
    if (!entry.isFile() || !/\.(?:[cm]?js|ts)$/.test(entry.name)) return [];
    return [entryPath];
  });
}

test('bounded telemetry import requires an explicit protected source', () => {
  assert.throws(() => parseArgs([]), /--source is required/);
  assert.throws(
    () => parseArgs(['--source', 'relative-export.json']),
    /absolute path outside the repository/,
  );
  assert.throws(
    () => parseArgs(['--json', '/protected/export.json']),
    /Unknown argument/,
  );
  assert.throws(
    () => parseArgs(['--csv', '/protected/export.csv']),
    /Unknown argument/,
  );

  const args = parseArgs(['--source', '/protected/tool-runs.json']);
  assert.equal(args.sourcePath, '/protected/tool-runs.json');
  assert.equal('jsonPath' in args, false);
  assert.equal('csvPath' in args, false);
});

test('maintained scripts do not own a repository temporary-directory contract', () => {
  const sources = [
    ...scriptFiles('scripts'),
    ...scriptFiles('apps/tools/scripts'),
  ]
    .filter((filePath) => !filePath.endsWith('.test.mjs'))
    .map((filePath) => readFileSync(filePath, 'utf8'))
    .join('\n');

  assert.doesNotMatch(
    sources,
    /path\.(?:join|resolve)\([^)]*repoRoot[^)]*["']tmp["']/s,
  );
  assert.doesNotMatch(sources, /["']tmp\/?["']/);
  assert.doesNotMatch(sources, /tmp\/tool_runs\.(?:json|csv)/);
});

test('ignore rules and guidance do not create a repository tmp bucket', () => {
  const ignoreRules = readFileSync('.gitignore', 'utf8');
  const artifactsRunbook = readFileSync('docs/runbooks/artifacts.md', 'utf8');
  const cloudflareRunbook = readFileSync('docs/runbooks/cloudflare.md', 'utf8');
  const documentationIndex = readFileSync('docs/README.md', 'utf8');

  assert.doesNotMatch(ignoreRules, /^tmp\/$/m);
  assert.doesNotMatch(artifactsRunbook, /Remaining migration compatibility/);
  assert.doesNotMatch(cloudflareRunbook, /repository `tmp\/` defaults/);
  assert.match(artifactsRunbook, /owner-controlled disposition/i);
  assert.match(documentationIndex, /ignored-local-inventory-2026-08-11\.md/);
});

test('documentation verification follows tracked sources instead of ignored buckets', () => {
  const verifier = readFileSync('scripts/verify-documentation.mjs', 'utf8');

  assert.match(verifier, /git[\s\S]*ls-files/);
  assert.doesNotMatch(verifier, /SKIPPED_DIRECTORIES/);
});

test('protected import does not print or retain its source filename', () => {
  const importer = readFileSync(
    'apps/tools/scripts/import-tool-runs-to-d1.mjs',
    'utf8',
  );
  assert.doesNotMatch(
    importer,
    /console\.(?:log|error)\([^)]*(?:sourcePath|resolvedPath)/s,
  );
  assert.match(importer, /explicit protected source/);
});

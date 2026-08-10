import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const extensionSource = readFileSync('scripts/fetch-store-assets.mjs', 'utf8');
const downloaderSource = readFileSync(
  'scripts/sync-downloader-landers-from-registry.mjs',
  'utf8',
);
const downloaderLibrarySource = readFileSync(
  'scripts/lib/downloader-registry-sync.mjs',
  'utf8',
);

test('catalog sync commands separate check and write roles', () => {
  for (const name of [
    'sync:extensions:check',
    'sync:downloader-registry:check',
  ]) {
    assert.match(packageJson.scripts[name], /--check/);
  }
  for (const name of [
    'sync:extensions:write',
    'sync:downloader-registry:write',
  ]) {
    assert.match(packageJson.scripts[name], /--write/);
  }
  assert.equal(packageJson.scripts['sync:network-brands'], undefined);
  assert.equal(packageJson.scripts['sync:network-brands:check'], undefined);
  assert.equal(packageJson.scripts['sync:network-brands:write'], undefined);
});

test('catalog syncs name authority and owned outputs', () => {
  for (const source of [extensionSource, downloaderSource]) {
    assert.match(source, /input authority/i);
    assert.match(source, /owned output/i);
    assert.match(source, /proposed/i);
  }
  assert.match(
    readFileSync('docs/runbooks/catalog-syncs.md', 'utf8'),
    /network-brand sync is retired/i,
  );
});

test('downloader sync verifies only exact registry URLs', () => {
  assert.doesNotMatch(downloaderLibrarySource, /https:\/\/serp\.ly\/\$\{/);
  assert.doesNotMatch(
    downloaderLibrarySource,
    /https:\/\/github\.com\/serpapps\/\$\{/,
  );
  assert.doesNotMatch(
    downloaderLibrarySource,
    /https:\/\/apps\.serp\.co\/\$\{/,
  );
  assert.match(downloaderSource, /exact registry URL/i);
  assert.doesNotMatch(downloaderSource, /authority-file/);
});

test('catalog sync runbook documents transient failures and review flow', () => {
  const runbook = readFileSync('docs/runbooks/catalog-syncs.md', 'utf8');
  assert.match(runbook, /input authority/i);
  assert.match(runbook, /owned outputs/i);
  assert.match(runbook, /transient/i);
  assert.match(runbook, /check.*write/is);
  assert.match(readFileSync('docs/README.md', 'utf8'), /catalog-syncs\.md/);
});

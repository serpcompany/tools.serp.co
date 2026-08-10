import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCatalogSyncMode } from './catalog-sync-mode.mjs';

test('catalog sync mode is check-only by default', () => {
  assert.deepEqual(parseCatalogSyncMode([]), { write: false });
  assert.deepEqual(parseCatalogSyncMode(['--check']), { write: false });
  assert.deepEqual(parseCatalogSyncMode(['--write']), { write: true });
});

test('catalog sync mode rejects conflicting and unknown roles', () => {
  assert.throws(
    () => parseCatalogSyncMode(['--check', '--write']),
    /only one/i,
  );
  assert.throws(() => parseCatalogSyncMode(['--dry-ish']), /unknown/i);
});

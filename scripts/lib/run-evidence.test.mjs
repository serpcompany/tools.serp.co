import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { recordRunEvidence } from './run-evidence.mjs';

test('evidence adapter writes the structured artifact contract', (t) => {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), 'tools-serp-run-evidence-'),
  );
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));

  const result = recordRunEvidence({
    repositoryRoot,
    command: 'canary:cloudflare:deployed',
    commandVersion: '1',
    revision: 'a'.repeat(40),
    environment: 'main',
    scope: 'cloudflare-production',
    status: 'failure',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    linkedWork: ['#58'],
    toolIds: ['png-to-webp', 'video-downloader'],
    invariants: ['generic-file-exact-output', 'url-stream-exact-output'],
    summary: {
      status: 'failure',
      checksPassed: 7,
      checksFailed: 1,
      items: 8,
      durationMs: 60_000,
      samples: 4,
      minMs: 20,
      p50Ms: 30,
      p95Ms: 50,
      maxMs: 50,
    },
  });

  assert.equal(
    result.runId,
    '20260101T000000Z_aaaaaaa_main_cloudflare-production',
  );
  const runRoot = path.join(repositoryRoot, '.artifacts', 'runs', result.runId);
  const manifest = JSON.parse(
    readFileSync(path.join(runRoot, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.command.name, 'canary:cloudflare:deployed');
  assert.equal(manifest.revision.commit, 'a'.repeat(40));
  assert.equal(manifest.environment, 'main');
  assert.equal(manifest.scope.label, 'cloudflare-production');
  assert.deepEqual(manifest.scope.toolIds, ['png-to-webp', 'video-downloader']);
  assert.deepEqual(manifest.scope.invariants, [
    'generic-file-exact-output',
    'url-stream-exact-output',
  ]);
  assert.equal(manifest.result.status, 'failure');
  assert.equal(
    readFileSync(path.join(runRoot, 'summary.txt'), 'utf8'),
    [
      'status=failure',
      'checks-passed=7',
      'checks-failed=1',
      'items=8',
      'duration-ms=60000',
      'samples=4',
      'min-ms=20',
      'p50-ms=30',
      'p95-ms=50',
      'max-ms=50',
      '',
    ].join('\n'),
  );
});

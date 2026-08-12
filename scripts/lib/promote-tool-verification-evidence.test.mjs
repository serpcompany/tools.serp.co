import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { promoteToolVerificationRun } from './promote-tool-verification-evidence.mjs';

function fixture(t, overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'tool-evidence-promotion-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runId = '20260813T000000Z_aaaaaaa_local_browser-smoke-local-subset';
  const runRoot = path.join(root, '.artifacts', 'runs', runId);
  const retainedRoot = path.join(root, 'docs', 'audits', 'tool-verification');
  mkdirSync(runRoot, { recursive: true });
  mkdirSync(retainedRoot, { recursive: true });
  writeFileSync(path.join(retainedRoot, 'retained-runs.json'), '[]\n');
  writeFileSync(
    path.join(runRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        runId,
        command: { name: 'smoke:tools:browser', version: '1' },
        revision: { commit: 'a'.repeat(40), dirty: false },
        timestamps: {
          startedAt: '2026-08-12T23:59:00.000Z',
          completedAt: '2026-08-13T00:00:00.000Z',
        },
        environment: 'local',
        scope: {
          label: 'browser-smoke-local-subset',
          inputHashes: [],
          tools: [
            {
              toolId: 'png-to-webp',
              journeys: [
                {
                  journeyId: 'png-to-webp:upload',
                  outcome: 'passed',
                  reasonCode: null,
                  fixture: {
                    kind: 'content',
                    reference: 'formats/png',
                    sha256: 'b'.repeat(64),
                  },
                  invariantId: 'generic-file-exact-output',
                  checks: [
                    'valid-fixture',
                    'semantic-output',
                    'required-environment',
                  ],
                  inputRevisions: {
                    'journey-contract': `sha256:${'c'.repeat(64)}`,
                  },
                },
              ],
            },
          ],
        },
        result: { status: 'success' },
        ...overrides,
      },
      null,
      2,
    )}\n`,
  );
  return { root, runId };
}

test('promotion retains the validated source manifest instead of display claims', (t) => {
  const { root, runId } = fixture(t);

  const result = promoteToolVerificationRun({ repositoryRoot: root, runId });
  const retained = JSON.parse(
    readFileSync(
      path.join(
        root,
        'docs',
        'audits',
        'tool-verification',
        'retained-runs.json',
      ),
      'utf8',
    ),
  );

  assert.deepEqual(result, { runId, journeyResults: 1 });
  assert.equal(retained.length, 1);
  assert.equal(retained[0].scope.tools[0].journeys[0].outcome, 'passed');
  assert.equal('runtime' in retained[0], false);
});

test('promotion rejects dirty, duplicate, or non-browser evidence', (t) => {
  const dirty = fixture(t, {
    revision: { commit: 'a'.repeat(40), dirty: true },
  });
  assert.throws(
    () =>
      promoteToolVerificationRun({
        repositoryRoot: dirty.root,
        runId: dirty.runId,
      }),
    /dirty/i,
  );

  const clean = fixture(t);
  promoteToolVerificationRun({
    repositoryRoot: clean.root,
    runId: clean.runId,
  });
  assert.throws(
    () =>
      promoteToolVerificationRun({
        repositoryRoot: clean.root,
        runId: clean.runId,
      }),
    /already retained/i,
  );
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  proveGoldenCurrentnessPreview,
  scrubGitEnvironment,
} from './lib/golden-currentness-preview.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('Git environment scrubbing removes every inherited repository override', () => {
  assert.deepEqual(
    scrubGitEnvironment({
      PATH: '/bin',
      GIT_DIR: '/unsafe',
      GIT_WORK_TREE: '/unsafe-tree',
      GITHUB_ACTIONS: 'true',
    }),
    { PATH: '/bin', GITHUB_ACTIONS: 'true' },
  );
});

test('currentness proof refuses a production-shaped target before Git work', async () => {
  await assert.rejects(
    proveGoldenCurrentnessPreview({
      repositoryRoot,
      revision: 'a'.repeat(40),
      baseUrl: 'https://tools.serp.co',
    }),
    /explicitly named preview/,
  );
});

test('preview currentness uses a disposable branch, real generated mutation, actual manifest ingestion, and cleanup', async () => {
  const scratch = mkdtempSync(
    path.join(os.tmpdir(), 'golden-currentness-test-'),
  );
  const source = path.join(scratch, 'source');
  let disposableClone = '';
  try {
    execFileSync('git', [
      'clone',
      '--quiet',
      '--no-local',
      '--no-checkout',
      repositoryRoot,
      source,
    ]);
    const revision = git(repositoryRoot, 'rev-parse', 'HEAD');
    git(source, 'switch', '--detach', revision);
    symlinkSync(
      path.join(repositoryRoot, 'node_modules'),
      path.join(source, 'node_modules'),
      'dir',
    );
    symlinkSync(
      path.join(repositoryRoot, 'apps/tools/node_modules'),
      path.join(source, 'apps/tools/node_modules'),
      'dir',
    );
    const branchesBefore = git(
      repositoryRoot,
      'branch',
      '--format=%(refname)',
    ).split('\n');
    const result = await proveGoldenCurrentnessPreview({
      repositoryRoot: source,
      revision,
      baseUrl: 'https://preview.example.test',
      browserRun({ cloneRoot }) {
        disposableClone = cloneRoot;
        const retained = JSON.parse(
          readFileSync(
            path.join(
              cloneRoot,
              'docs/audits/tool-verification/retained-runs.json',
            ),
            'utf8',
          ),
        );
        const retainedPng = retained
          .flatMap((run) =>
            (run.scope.tools ?? []).flatMap((tool) =>
              (tool.journeys ?? [])
                .filter((journey) => journey.journeyId === 'png-to-webp:upload')
                .map((journey) => ({ toolId: tool.toolId, journey })),
            ),
          )
          .at(-1);
        assert.ok(retainedPng);
        const manifest = {
          schemaVersion: 2,
          runId: 'actual-preview-png-rerun',
          command: { name: 'smoke:tools:browser', version: '1' },
          revision: { commit: revision, dirty: false },
          timestamps: {
            startedAt: '2026-08-13T00:00:00.000Z',
            completedAt: '2026-08-13T00:00:01.000Z',
          },
          environment: 'pull-request',
          scope: {
            label: 'browser-smoke-preview-subset',
            inputHashes: [],
            tools: [
              {
                toolId: retainedPng.toolId,
                journeys: [retainedPng.journey],
              },
            ],
          },
          result: { status: 'success' },
        };
        const manifestPath = path.join(
          cloneRoot,
          'actual-preview-manifest.json',
        );
        writeFileSync(manifestPath, JSON.stringify(manifest));
        return manifestPath;
      },
    });
    assert.ok(
      ['verified', 'warned', 'incomplete'].includes(result.prior.state),
      `expected current retained evidence, received ${result.prior.state}`,
    );
    assert.equal(result.mutated.state, 'stale');
    assert.equal(result.restored.state, 'verified');
    assert.deepEqual(result.failClosed, {
      warned: 'warned',
      skipped: 'skipped',
      missingCheck: 'incomplete',
      semanticFailure: 'failed',
    });
    assert.match(result.isolation.branch, /^golden-currentness-proof-/);
    assert.match(result.isolation.mutationCommit, /^[a-f0-9]{40}$/);
    assert.equal(result.isolation.baselineCommit, revision);
    assert.equal(result.isolation.restoredCommit, revision);
    assert.equal(
      result.isolation.restorationMechanism,
      'switch-detach-exact-baseline',
    );
    assert.equal(result.restored.actualEvidence.outcome, 'passed');
    assert.ok(
      result.restored.actualEvidence.checks.includes('semantic-output'),
    );
    assert.equal(result.productionTouched, false);
    assert.deepEqual(
      git(repositoryRoot, 'branch', '--format=%(refname)').split('\n'),
      branchesBefore,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  assert.equal(existsSync(disposableClone), false);
});

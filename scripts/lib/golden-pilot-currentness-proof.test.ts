import assert from 'node:assert/strict';
import test from 'node:test';

import { proveGoldenPilotEvidenceCurrentness } from './golden-pilot-currentness-proof.ts';

test('Golden pilot mechanically proves current to stale to current evidence and fail-closed outcomes', () => {
  const gitDirectoryVariable = ['GIT', 'DIR'].join('_');
  const gitWorkTreeVariable = ['GIT', 'WORK', 'TREE'].join('_');
  const originalGitDirectory = process.env[gitDirectoryVariable];
  const originalGitWorkTree = process.env[gitWorkTreeVariable];
  process.env[gitDirectoryVariable] = '/invalid/hook-repository';
  process.env[gitWorkTreeVariable] = '/invalid/hook-worktree';
  let proof: ReturnType<typeof proveGoldenPilotEvidenceCurrentness>;
  try {
    proof = proveGoldenPilotEvidenceCurrentness();
  } finally {
    if (originalGitDirectory === undefined)
      delete process.env[gitDirectoryVariable];
    else process.env[gitDirectoryVariable] = originalGitDirectory;
    if (originalGitWorkTree === undefined)
      delete process.env[gitWorkTreeVariable];
    else process.env[gitWorkTreeVariable] = originalGitWorkTree;
  }

  assert.equal(proof.journeyId, 'png-to-webp:upload');
  assert.equal(proof.changedInput, 'fixture-content');
  assert.deepEqual(proof.transitions, [
    { step: 'current-before-change', state: 'verified' },
    { step: 'fixture-changed', state: 'stale' },
    { step: 'restored-and-rerun', state: 'verified' },
  ]);
  assert.deepEqual(proof.failClosed, {
    warned: 'warned',
    skipped: 'skipped',
    missingCheck: 'incomplete',
    semanticFailure: 'failed',
  });
  assert.equal(
    proof.mechanism.evidencePath,
    'manifest ingestion -> production evidence projection',
  );
  assert.equal(proof.mechanism.restorationExact, true);
  assert.deepEqual(
    {
      kind: proof.mechanism.isolation.kind,
      branch: proof.mechanism.isolation.branch,
      worktreeClean: proof.mechanism.isolation.worktreeClean,
    },
    {
      kind: 'disposable-git-branch',
      branch: 'golden-currentness-proof',
      worktreeClean: true,
    },
  );
  for (const commit of [
    proof.mechanism.isolation.baselineCommit,
    proof.mechanism.isolation.mutationCommit,
    proof.mechanism.isolation.restorationCommit,
  ]) {
    assert.match(commit, /^[a-f0-9]{40}$/);
  }
  assert.equal(
    new Set([
      proof.mechanism.isolation.baselineCommit,
      proof.mechanism.isolation.mutationCommit,
      proof.mechanism.isolation.restorationCommit,
    ]).size,
    3,
  );
  assert.notEqual(
    proof.mechanism.originalFileDigest,
    proof.mechanism.mutatedFileDigest,
  );
  assert.equal(
    proof.mechanism.observedFixtureRevisions.before,
    proof.mechanism.observedFixtureRevisions.restored,
  );
  assert.notEqual(
    proof.mechanism.observedFixtureRevisions.before,
    proof.mechanism.observedFixtureRevisions.mutated,
  );
  assert.deepEqual(proof.failClosedRunIds, {
    warned: 'golden-fail-closed-warned',
    skipped: 'golden-fail-closed-skipped',
    missingCheck: 'golden-fail-closed-missing-check',
    semanticFailure: 'golden-fail-closed-semantic-failure',
  });
  for (const evidence of Object.values(proof.failClosedEvidence)) {
    assert.equal(evidence.appearsVerified, false);
  }
  assert.throws(
    () =>
      (
        proof.transitions as unknown as Array<{
          step: string;
          state: string;
        }>
      ).pop(),
    TypeError,
  );
});

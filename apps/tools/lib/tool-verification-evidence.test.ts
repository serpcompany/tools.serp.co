import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildToolVerificationEvidenceIndex,
  retainedToolVerificationEvidence,
} from './tool-verification-evidence.ts';

const knownTools = [
  { toolId: 'png-to-webp', family: 'generic-convert:browser-raster' },
  { toolId: 'bmp-to-png', family: 'generic-convert:browser-raster' },
  { toolId: 'audio-to-text', family: 'renderer:transcription' },
  { toolId: 'pdf-reader', family: 'renderer:specialized' },
];

test('retained evidence attaches the latest exact Tool result with plain checked behavior', () => {
  const index = buildToolVerificationEvidenceIndex(
    retainedToolVerificationEvidence,
    knownTools,
  );

  const evidence = index.getForTool(
    'png-to-webp',
    'generic-convert:browser-raster',
  );

  assert.ok(evidence.exact);
  assert.equal(evidence.exact.scope, 'exact-tool');
  assert.equal(evidence.exact.result, 'passed');
  assert.equal(
    evidence.exact.verifiedRevision,
    '03dc90f5213560ff61493dd058b877f9666b8338',
  );
  assert.deepEqual(evidence.exact.checkedBehaviors, [
    'Converted a real PNG and produced a WebP file.',
  ]);
  assert.match(evidence.exact.screenshotUrl, /workflow-preview-png-to-webp/);
  assert.deepEqual(evidence.family, []);
});

test('a Tool without exact retained evidence stays explicitly untested', () => {
  const index = buildToolVerificationEvidenceIndex(
    retainedToolVerificationEvidence,
    knownTools,
  );

  assert.deepEqual(
    index.getForTool('bmp-to-png', 'generic-convert:browser-raster'),
    { exact: null, family: [] },
  );
});

test('retained family evidence carries explicit membership and never becomes an exact Tool result', () => {
  const index = buildToolVerificationEvidenceIndex(
    retainedToolVerificationEvidence,
    knownTools,
  );

  const evidence = index.getForTool('audio-to-text', 'renderer:transcription');

  assert.ok(evidence.exact);
  assert.equal(evidence.family.length, 1);
  assert.equal(evidence.family[0]?.scope, 'family');
  assert.deepEqual(evidence.family[0]?.toolIds, ['audio-to-text']);
  assert.deepEqual(evidence.family[0]?.checkedBehaviors, [
    'The representative family browser run included real speech transcription for this Tool.',
  ]);
});

test('newer exact evidence supersedes an older result instead of attaching stale evidence', () => {
  const base = retainedToolVerificationEvidence[0];
  assert.ok(base);
  if (base.scope !== 'exact-tool') assert.fail('expected exact Tool evidence');
  const newer = {
    ...base,
    evidenceId: 'png-to-webp-newer',
    verifiedAt: '2026-08-13T00:00:00.000Z',
    result: 'failed' as const,
    checkedBehaviors: ['Rejected a deliberately invalid output.'],
  };
  const index = buildToolVerificationEvidenceIndex([base, newer], knownTools);

  assert.equal(
    index.getForTool('png-to-webp', 'generic-convert:browser-raster').exact
      ?.evidenceId,
    'png-to-webp-newer',
  );
});

test('mismatched artifact revision and Tool membership fail closed', () => {
  const base = retainedToolVerificationEvidence[0];
  assert.ok(base);
  if (base.scope !== 'exact-tool') assert.fail('expected exact Tool evidence');

  assert.throws(
    () =>
      buildToolVerificationEvidenceIndex(
        [
          {
            ...base,
            artifact: { ...base.artifact, revision: 'a'.repeat(40) },
          },
        ],
        knownTools,
      ),
    /revision does not match/,
  );
  assert.throws(
    () =>
      buildToolVerificationEvidenceIndex(
        [{ ...base, toolId: 'not-a-real-tool' }],
        knownTools,
      ),
    /unknown Tool/,
  );
});

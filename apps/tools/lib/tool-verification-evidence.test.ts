import assert from 'node:assert/strict';
import test from 'node:test';

import { toolJourneys } from './tool-journeys.ts';
import {
  buildToolVerificationEvidenceIndex,
  getRequiredVerificationChecks,
  getToolVerificationInputRevisions,
  ingestToolVerificationRun,
  requiredVerificationChecks,
  type ToolJourneyEvidenceRecord,
} from './tool-verification-evidence.ts';

const journey = toolJourneys.getByToolId('png-to-webp')[0];
assert.ok(journey);
const unsupportedExtractorJourney = toolJourneys
  .getByToolId('audio-to-text')
  .find((candidate) => candidate.input.kind === 'extractor-url');
assert.ok(unsupportedExtractorJourney);

const currentInputRevisions = Object.freeze({
  'journey-contract': `sha256:${'1'.repeat(64)}`,
  'semantic-invariant': `sha256:${'2'.repeat(64)}`,
  'fixture-contract': `sha256:${'3'.repeat(64)}`,
  'fixture-content': `sha256:${'b'.repeat(64)}`,
  'verification-policy': `sha256:${'4'.repeat(64)}`,
  'executable-sources': `sha256:${'5'.repeat(64)}`,
  'dependency-lock': `sha256:${'6'.repeat(64)}`,
  'runner-sources': `sha256:${'7'.repeat(64)}`,
});

function record(
  overrides: Partial<ToolJourneyEvidenceRecord> = {},
): ToolJourneyEvidenceRecord {
  return {
    evidenceId: 'browser-png-to-webp-upload',
    runId: '20260813T000000Z_aaaaaaa_local_browser-smoke-local-subset',
    toolId: 'png-to-webp',
    journeyId: 'png-to-webp:upload',
    observedAt: '2026-08-13T00:00:00.000Z',
    revision: { commit: 'a'.repeat(40), dirty: false },
    environment: 'local-browser',
    outcome: 'passed',
    reasonCode: null,
    fixture: {
      kind: 'content',
      reference: 'formats/png',
      sha256: 'b'.repeat(64),
    },
    invariantId: 'generic-file-exact-output',
    checks: requiredVerificationChecks,
    inputRevisions: currentInputRevisions,
    artifactUrl: null,
    screenshotUrl: null,
    ...overrides,
  };
}

function build(records: readonly ToolJourneyEvidenceRecord[]) {
  return buildToolVerificationEvidenceIndex({
    journeys: toolJourneys.all,
    records,
    currentInputRevisions() {
      return currentInputRevisions;
    },
  });
}

test('required checks follow the promised journey outcome instead of one global conversion checklist', () => {
  assert.deepEqual(getRequiredVerificationChecks(journey), [
    'valid-fixture',
    'semantic-output',
    'malformed-input',
    'spoofed-input',
    'wrong-format-output',
    'no-delivery-on-failure',
    'cancellation-lifecycle',
    'required-environment',
  ]);
  assert.deepEqual(getRequiredVerificationChecks(unsupportedExtractorJourney), [
    'valid-fixture',
    'semantic-output',
    'no-delivery-on-failure',
    'required-environment',
  ]);
});

test('an exact current journey result becomes verified only with every required check', () => {
  const index = build([record()]);

  assert.deepEqual(index.getForJourney(journey.id), {
    journeyId: 'png-to-webp:upload',
    state: 'verified',
    latest: record(),
    missingChecks: [],
    reason: 'Current controlled evidence satisfies every required check.',
  });
  assert.equal(index.summary.verified, 1);
  assert.equal(index.summary.noEvidence, toolJourneys.all.length - 1);
});

test('warning, skip, semantic failure, and incomplete checks never become verified', () => {
  const cases = [
    {
      value: record({
        evidenceId: 'warning',
        outcome: 'warned',
        reasonCode: 'browser-capability-unavailable',
      }),
      state: 'warned',
    },
    {
      value: record({
        evidenceId: 'skip',
        outcome: 'skipped',
        reasonCode: 'fixture-missing',
      }),
      state: 'skipped',
    },
    {
      value: record({
        evidenceId: 'failure',
        outcome: 'failed',
        reasonCode: 'semantic-output-mismatch',
      }),
      state: 'failed',
    },
    {
      value: record({
        evidenceId: 'incomplete',
        checks: ['valid-fixture', 'semantic-output'],
      }),
      state: 'incomplete',
    },
    {
      value: record({
        evidenceId: 'warning-on-pass',
        warningCodes: ['other-console-warning'],
      }),
      state: 'warned',
    },
  ] as const;

  for (const item of cases) {
    assert.equal(
      build([item.value]).getForJourney(journey.id).state,
      item.state,
    );
  }
});

test('dirty, stale, mismatched, duplicate, or missing proof fails closed', () => {
  assert.equal(
    build([
      record({ revision: { commit: 'a'.repeat(40), dirty: true } }),
    ]).getForJourney(journey.id).state,
    'invalid',
  );
  assert.equal(
    build([
      record({
        inputRevisions: {
          ...currentInputRevisions,
          'verification-policy': `sha256:${'9'.repeat(64)}`,
        },
      }),
    ]).getForJourney(journey.id).state,
    'stale',
  );
  assert.throws(
    () => build([record({ journeyId: 'audio-to-text:upload' })]),
    /does not belong to Tool/i,
  );
  assert.throws(() => build([record(), record()]), /duplicate evidence/i);
  assert.equal(
    build([record({ fixture: null })]).getForJourney(journey.id).state,
    'invalid',
  );
  assert.equal(
    build([
      record({
        outcome: 'skipped',
        reasonCode: 'fixture-missing',
        fixture: null,
      }),
    ]).getForJourney(journey.id).state,
    'skipped',
  );
  assert.equal(
    build([record({ invariantId: null })]).getForJourney(journey.id).state,
    'invalid',
  );
});

test('returned evidence projections are immutable and Tool-scoped', () => {
  const view = build([record()]).getForTool('png-to-webp');

  assert.deepEqual(
    view.map((item) => item.journeyId),
    ['png-to-webp:upload'],
  );
  assert.throws(() => {
    (view as unknown as unknown[]).push({});
  }, TypeError);
  assert.throws(() => {
    (view[0]?.latest?.checks as unknown as string[]).push('invented');
  }, TypeError);
});

test('currentness revisions are source-derived from the exact journey and verification policy', () => {
  const inputs = getToolVerificationInputRevisions(journey);

  assert.deepEqual(Object.keys(inputs), [
    'fixture-contract',
    'fixture-content',
    'journey-contract',
    'semantic-invariant',
    'verification-policy',
    'executable-sources',
    'dependency-lock',
    'runner-sources',
  ]);
  assert.ok(
    Object.values(inputs).every((value) => /^sha256:[a-f0-9]{64}$/.test(value)),
  );
  assert.notEqual(
    getToolVerificationInputRevisions({
      ...journey,
      promisedOutcome: `${journey.promisedOutcome} changed`,
    })['journey-contract'],
    inputs['journey-contract'],
  );
  assert.equal(
    getToolVerificationInputRevisions({
      ...journey,
      promisedOutcome: `${journey.promisedOutcome} changed`,
    })['fixture-contract'],
    inputs['fixture-contract'],
  );
});

test('a structured browser manifest expands into exact source-derived journey records', () => {
  const records = ingestToolVerificationRun({
    schemaVersion: 2,
    runId: '20260813T000000Z_aaaaaaa_local_browser-smoke-local-subset',
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
              inputRevisions: currentInputRevisions,
            },
          ],
        },
      ],
    },
    result: { status: 'success' },
  });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    ...record(),
    evidenceId: records[0]?.evidenceId,
    checks: ['valid-fixture', 'semantic-output', 'required-environment'],
    warningCodes: [],
  });
});

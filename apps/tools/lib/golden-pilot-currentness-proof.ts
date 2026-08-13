import { fileURLToPath } from 'node:url';

import { toolJourneys } from './tool-journeys.ts';
import {
  buildToolVerificationEvidenceIndex,
  getRequiredVerificationChecks,
  getToolVerificationInputRevisions,
  type ToolJourneyEvidenceOutcome,
  type ToolJourneyEvidenceRecord,
} from './tool-verification-evidence.ts';

function freeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export function proveGoldenPilotEvidenceCurrentness() {
  const journey = toolJourneys
    .getByToolId('png-to-webp')
    .find((candidate) => candidate.id === 'png-to-webp:upload');
  if (!journey) throw new TypeError('Golden currentness journey is missing.');

  const current = getToolVerificationInputRevisions(journey);
  const fixtureContent = current['fixture-content'];
  if (!fixtureContent?.startsWith('sha256:') || !journey.fixture.reference) {
    throw new TypeError('Golden currentness fixture digest is missing.');
  }
  const baseRecord: ToolJourneyEvidenceRecord = freeze({
    evidenceId: 'golden-currentness-png-to-webp',
    runId: 'golden-currentness-proof',
    toolId: journey.toolId,
    journeyId: journey.id,
    observedAt: '2026-08-13T00:00:00.000Z',
    revision: { commit: 'a'.repeat(40), dirty: false },
    environment: 'local-browser',
    outcome: 'passed',
    reasonCode: null,
    fixture: {
      kind: 'content',
      reference: journey.fixture.reference,
      sha256: fixtureContent.slice('sha256:'.length),
    },
    invariantId: journey.semanticInvariant.id,
    checks: getRequiredVerificationChecks(journey),
    inputRevisions: current,
    artifactUrl: null,
    screenshotUrl: null,
  });

  const state = (
    record: ToolJourneyEvidenceRecord,
    inputs: Readonly<Record<string, string>> = current,
  ) =>
    buildToolVerificationEvidenceIndex({
      journeys: [journey],
      records: [record],
      currentInputRevisions: () => inputs,
    }).getForJourney(journey.id).state;
  const withOutcome = (
    outcome: ToolJourneyEvidenceOutcome,
    reasonCode: string,
  ): ToolJourneyEvidenceRecord =>
    freeze({
      ...baseRecord,
      evidenceId: `golden-${outcome}`,
      outcome,
      reasonCode,
    });
  const changedInputs = freeze({
    ...current,
    'fixture-content': `sha256:${'0'.repeat(64)}`,
  });
  const missingCheckRecord = freeze({
    ...baseRecord,
    evidenceId: 'golden-missing-check',
    checks: baseRecord.checks.filter(
      (check) => check !== 'cancellation-lifecycle',
    ),
  });

  return freeze({
    journeyId: journey.id,
    changedInput: 'fixture-content' as const,
    transitions: [
      { step: 'current-before-change' as const, state: state(baseRecord) },
      {
        step: 'fixture-changed' as const,
        state: state(baseRecord, changedInputs),
      },
      { step: 'restored-and-rerun' as const, state: state(baseRecord) },
    ],
    failClosed: {
      warned: state(withOutcome('warned', 'controlled-warning')),
      skipped: state(withOutcome('skipped', 'controlled-skip')),
      missingCheck: state(missingCheckRecord),
      semanticFailure: state(withOutcome('failed', 'semantic-output-mismatch')),
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${JSON.stringify(proveGoldenPilotEvidenceCurrentness())}\n`,
  );
}

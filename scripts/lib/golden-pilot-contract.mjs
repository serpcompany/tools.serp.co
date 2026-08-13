import { goldenToolJourneyPilot } from '../../apps/tools/lib/golden-tool-journey-pilot.ts';

const EXPECTED_JOURNEYS = goldenToolJourneyPilot.journeys.map(
  (journey) => journey.id,
);

export function assertGoldenBrowserManifest(manifest) {
  const journeys = manifest.scope.tools.flatMap((tool) => tool.journeys);
  const byId = new Map(journeys.map((journey) => [journey.journeyId, journey]));
  if (
    journeys.length !== EXPECTED_JOURNEYS.length ||
    EXPECTED_JOURNEYS.some((journeyId) => !byId.has(journeyId))
  ) {
    throw new Error(
      'Golden browser evidence did not contain the fixed journey membership.',
    );
  }
  for (const journeyId of EXPECTED_JOURNEYS) {
    const journey = byId.get(journeyId);
    if (journeyId === 'compress-pdf:upload') {
      if (
        journey.outcome !== 'warned' ||
        journey.reasonCode !== 'browser-check-warning' ||
        !journey.checks.includes('no-delivery-on-failure')
      ) {
        throw new Error(
          'Golden server-unavailable journey was not an honest no-delivery warning.',
        );
      }
      continue;
    }
    if (
      journey.outcome !== 'passed' ||
      !journey.checks.includes('semantic-output')
    ) {
      throw new Error(
        `${journeyId} did not retain passed semantic-output evidence.`,
      );
    }
  }
  return journeys;
}

export function summarizeGoldenPilotProjection(rows) {
  const byId = new Map(rows.map((row) => [row.journeyId, row]));
  if (
    rows.length !== EXPECTED_JOURNEYS.length ||
    EXPECTED_JOURNEYS.some((journeyId) => !byId.has(journeyId))
  ) {
    throw new Error(
      'Golden projection did not contain the fixed journey membership.',
    );
  }
  const counts = Object.freeze(
    rows.reduce((summary, row) => {
      summary[row.evidenceState] = (summary[row.evidenceState] ?? 0) + 1;
      return summary;
    }, {}),
  );
  const readyToContinue = EXPECTED_JOURNEYS.every((journeyId) => {
    const state = byId.get(journeyId)?.evidenceState;
    return journeyId === 'compress-pdf:upload'
      ? state === 'warned'
      : state === 'verified';
  });
  return Object.freeze({
    executionStatus: 'completed',
    verificationDecision: readyToContinue ? 'continue' : 'repair',
    acceptanceStatus: readyToContinue
      ? 'ready-for-maintainer-decision'
      : 'not-accepted',
    evidenceCounts: counts,
  });
}

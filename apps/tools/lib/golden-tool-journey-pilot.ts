import { toolJourneys, type ToolJourney } from './tool-journeys.ts';
import type { ToolClientFirstRow } from './tool-client-first-plan.ts';
import type { ToolFactoryRow } from './tool-factory-read-model.ts';
import type {
  ToolJourneyEvidenceState,
  ToolVerificationCheck,
} from './tool-verification-evidence.ts';

const JOURNEY_IDS = Object.freeze([
  'audio-to-text:extractor-url',
  'audio-to-text:upload',
  'audio-to-transcript:direct-url',
  'batch-compress-png:multiple-file-upload',
  'bmp-to-png:upload',
  'compress-pdf:upload',
  'csv-to-json:upload',
  'pdf-reader:upload',
  'png-to-webp:upload',
  'video-downloader:direct-url',
] as const);

const byId = new Map(toolJourneys.all.map((journey) => [journey.id, journey]));
const journeys = Object.freeze(
  JOURNEY_IDS.map((id) => {
    const journey = byId.get(id);
    if (!journey)
      throw new TypeError(`Golden pilot journey is missing: ${id}.`);
    return journey;
  }),
) satisfies readonly ToolJourney[];

const membershipHash =
  'sha256:cf077705f900e695b0310fbd090dbd366fa3c01219f93b2076f849b3396ba6ba';

export const goldenToolJourneyPilot = Object.freeze({
  id: 'golden-journey-pilot-v1',
  membershipHash,
  journeys,
  toolIds: Object.freeze([
    ...new Set(journeys.map((journey) => journey.toolId)),
  ]),
  behaviors: Object.freeze({
    clientFileConversion: Object.freeze([
      'png-to-webp:upload',
      'bmp-to-png:upload',
    ]),
    structuredData: Object.freeze(['csv-to-json:upload']),
    batch: Object.freeze(['batch-compress-png:multiple-file-upload']),
    pdf: Object.freeze(['pdf-reader:upload']),
    transcriptionUpload: Object.freeze(['audio-to-text:upload']),
    transcriptionDirectUrl: Object.freeze(['audio-to-transcript:direct-url']),
    truthfulYoutubeUnsupported: Object.freeze(['audio-to-text:extractor-url']),
    directMediaDownload: Object.freeze(['video-downloader:direct-url']),
    serverUnavailable: Object.freeze(['compress-pdf:upload']),
    adversarialChecks: Object.freeze(['png-to-webp:upload']),
    cancellation: Object.freeze(['audio-to-text:upload']),
  }),
});

const checkLabels: Readonly<Record<ToolVerificationCheck, string>> =
  Object.freeze({
    'valid-fixture': 'valid fixture',
    'semantic-output': 'meaningful output',
    'malformed-input': 'malformed input rejection',
    'spoofed-input': 'spoofed input rejection',
    'wrong-format-output': 'wrong output rejection',
    'no-delivery-on-failure': 'no bogus delivery',
    'cancellation-lifecycle': 'cancellation and cleanup',
    'required-environment': 'required environment',
  });

const resultLabels: Readonly<Record<ToolJourneyEvidenceState, string>> =
  Object.freeze({
    verified: 'Verified',
    incomplete: 'Passed some checks · incomplete',
    failed: 'Failed',
    warned: 'Warning · not verified',
    skipped: 'Skipped · not verified',
    stale: 'Evidence is stale',
    invalid: 'Evidence is invalid',
    'no-evidence': 'No retained evidence',
  });

const executionLabels: Readonly<
  Record<ToolClientFirstRow['currentExecution']['state'], string>
> = Object.freeze({
  browser: 'Your browser',
  hybrid: 'Browser with a required server step',
  server: 'Server',
  unsupported: 'Unavailable',
  unknown: 'Not yet known',
});

export function buildGoldenToolJourneyPilotView(
  tools: readonly ToolFactoryRow[],
  clientFirstRows: readonly ToolClientFirstRow[],
) {
  const toolById = new Map(tools.map((tool) => [tool.toolId, tool]));
  const clientFirstById = new Map(
    clientFirstRows.map((tool) => [tool.toolId, tool]),
  );
  const rows = goldenToolJourneyPilot.journeys.map((journey) => {
    const tool = toolById.get(journey.toolId);
    const clientFirst = clientFirstById.get(journey.toolId);
    const evidence = tool?.verificationEvidence.find(
      (item) => item.journeyId === journey.id,
    );
    if (!tool || !clientFirst || !evidence) {
      throw new TypeError(`Golden pilot sources are missing ${journey.id}.`);
    }
    const checkedBehavior = evidence.latest?.checks.length
      ? evidence.latest.checks.map((check) => checkLabels[check]).join(', ')
      : 'No retained checks yet';
    const missing = evidence.missingChecks.map((check) => checkLabels[check]);
    const remainingGap = missing.length
      ? `${evidence.reason} Still needed: ${missing.join(', ')}.`
      : evidence.reason;
    return Object.freeze({
      journeyId: journey.id,
      toolId: journey.toolId,
      toolName: tool.name,
      inputKind: journey.input.kind,
      promisedOutcome: journey.promisedOutcome,
      evidenceState: evidence.state,
      resultLabel: resultLabels[evidence.state],
      whereItRuns: executionLabels[clientFirst.currentExecution.state],
      checkedBehavior,
      freshness:
        evidence.state === 'stale'
          ? 'Outdated for current inputs'
          : evidence.latest
            ? 'Current for its recorded inputs'
            : 'No evidence timestamp',
      remainingGap,
      tryHref: tool.route,
    });
  });
  const states = Object.keys(resultLabels) as ToolJourneyEvidenceState[];
  const summary = Object.freeze(
    Object.fromEntries(
      states.map((state) => [
        state,
        rows.filter((row) => row.evidenceState === state).length,
      ]),
    ) as Record<ToolJourneyEvidenceState, number>,
  );
  return Object.freeze({
    id: goldenToolJourneyPilot.id,
    membershipHash: goldenToolJourneyPilot.membershipHash,
    rows: Object.freeze(rows),
    summary,
  });
}

export type GoldenToolJourneyPilotView = ReturnType<
  typeof buildGoldenToolJourneyPilotView
>;

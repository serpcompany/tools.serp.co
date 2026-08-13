import { createHash } from 'node:crypto';

import retainedRuns from '../../../docs/audits/tool-verification/retained-runs.json' with { type: 'json' };
import generatedInputs from './tool-verification-inputs.generated.json' with { type: 'json' };
import { toolJourneys, type ToolJourney } from './tool-journeys.ts';

export const requiredVerificationChecks = Object.freeze([
  'valid-fixture',
  'semantic-output',
  'malformed-input',
  'spoofed-input',
  'wrong-format-output',
  'no-delivery-on-failure',
  'cancellation-lifecycle',
  'required-environment',
] as const);

export type ToolVerificationCheck = (typeof requiredVerificationChecks)[number];
export type ToolJourneyEvidenceOutcome =
  | 'passed'
  | 'failed'
  | 'warned'
  | 'skipped';
export type ToolJourneyEvidenceEnvironment =
  | 'local-browser'
  | 'preview-browser'
  | 'production-browser'
  | 'node-test';

export type ToolJourneyEvidenceRecord = Readonly<{
  evidenceId: string;
  runId: string;
  toolId: string;
  journeyId: string;
  observedAt: string;
  revision: Readonly<{ commit: string; dirty: boolean }>;
  environment: ToolJourneyEvidenceEnvironment;
  outcome: ToolJourneyEvidenceOutcome;
  reasonCode: string | null;
  fixture: Readonly<{
    kind: 'content' | 'literal';
    reference: string;
    sha256: string;
  }> | null;
  invariantId: string | null;
  checks: readonly ToolVerificationCheck[];
  inputRevisions: Readonly<Record<string, string>>;
  artifactUrl: string | null;
  screenshotUrl: string | null;
  warningCodes?: readonly string[];
}>;

export type ToolJourneyEvidenceState =
  | 'verified'
  | 'incomplete'
  | 'failed'
  | 'warned'
  | 'skipped'
  | 'stale'
  | 'invalid'
  | 'no-evidence';

export type ToolJourneyEvidenceView = Readonly<{
  journeyId: string;
  state: ToolJourneyEvidenceState;
  latest: ToolJourneyEvidenceRecord | null;
  missingChecks: readonly ToolVerificationCheck[];
  reason: string;
}>;

type BuildOptions = Readonly<{
  journeys: readonly ToolJourney[];
  records: readonly ToolJourneyEvidenceRecord[];
  currentInputRevisions(journey: ToolJourney): Readonly<Record<string, string>>;
}>;

export type ToolVerificationRunManifest = Readonly<{
  schemaVersion: number;
  runId: string;
  revision: Readonly<{ commit: string; dirty: boolean }>;
  timestamps: Readonly<{ startedAt: string; completedAt: string }>;
  environment: 'local' | 'pull-request' | 'main';
  scope: Readonly<{
    label: string;
    inputHashes: readonly string[];
    tools?: readonly Readonly<{
      toolId: string;
      warnings?: readonly string[];
      journeys: readonly Readonly<{
        journeyId: string;
        outcome: ToolJourneyEvidenceOutcome;
        reasonCode: string | null;
        fixture: ToolJourneyEvidenceRecord['fixture'];
        invariantId: string | null;
        checks: readonly ToolVerificationCheck[];
        inputRevisions: Readonly<Record<string, string>>;
      }>[];
    }>[];
  }>;
  result: Readonly<{ status: string }>;
}>;

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function revision(value: unknown) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function getToolVerificationInputRevisions(
  journey: ToolJourney,
): Readonly<Record<string, string>> {
  const fixtureSha256 =
    generatedInputs.fixtureSha256ByJourney[
      journey.id as keyof typeof generatedInputs.fixtureSha256ByJourney
    ];
  return deepFreeze({
    'fixture-contract': revision(journey.fixture),
    'fixture-content': fixtureSha256
      ? `sha256:${fixtureSha256}`
      : revision(null),
    'journey-contract': revision(journey),
    'semantic-invariant': revision(journey.semanticInvariant),
    'verification-policy': revision(requiredVerificationChecks),
    'executable-sources': generatedInputs.executableSources,
    'dependency-lock': generatedInputs.dependencyLock,
    'runner-sources': generatedInputs.runnerSources,
  });
}

export function ingestToolVerificationRun(
  manifest: ToolVerificationRunManifest,
): readonly ToolJourneyEvidenceRecord[] {
  if (manifest.schemaVersion !== 2) {
    throw new TypeError('Journey evidence requires artifact schema version 2.');
  }
  const environmentByRun = {
    local: 'local-browser',
    'pull-request': 'preview-browser',
    main: 'production-browser',
  } as const;
  const environment = environmentByRun[manifest.environment];
  if (!environment) {
    throw new TypeError('Journey evidence uses an unsupported environment.');
  }
  const records = (manifest.scope.tools ?? []).flatMap((tool) =>
    tool.journeys.map((journey) => ({
      evidenceId: `evidence-${createHash('sha256')
        .update(`${manifest.runId}\0${journey.journeyId}`)
        .digest('hex')}`,
      runId: manifest.runId,
      toolId: tool.toolId,
      journeyId: journey.journeyId,
      observedAt: manifest.timestamps.completedAt,
      revision: manifest.revision,
      environment,
      outcome: journey.outcome,
      reasonCode: journey.reasonCode,
      fixture: journey.fixture,
      invariantId: journey.invariantId,
      checks: journey.checks,
      inputRevisions: journey.inputRevisions,
      artifactUrl: null,
      screenshotUrl: null,
      warningCodes: [...(tool.warnings ?? [])],
    })),
  );
  return deepFreeze(records);
}

function fullRevision(value: string) {
  return /^[a-f0-9]{40}$/.test(value);
}

function sha256(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

function safeIdentity(value: string) {
  return /^[a-z0-9][a-z0-9:._-]*$/.test(value);
}

function safeRunIdentity(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function environmentSatisfies(
  journey: ToolJourney,
  environment: ToolJourneyEvidenceEnvironment,
) {
  if (journey.requiredEnvironment === 'browser') {
    return new Set([
      'local-browser',
      'preview-browser',
      'production-browser',
    ]).has(environment);
  }
  if (journey.requiredEnvironment === 'preview') {
    return environment === 'preview-browser';
  }
  return false;
}

function validateRecordIdentity(
  record: ToolJourneyEvidenceRecord,
  journeyById: ReadonlyMap<string, ToolJourney>,
) {
  if (!safeIdentity(record.evidenceId) || !safeRunIdentity(record.runId)) {
    throw new TypeError('Evidence and run identities must be safe slugs.');
  }
  if (!fullRevision(record.revision.commit)) {
    throw new TypeError(
      `Evidence ${record.evidenceId} must name a full Git revision.`,
    );
  }
  if (!Number.isFinite(Date.parse(record.observedAt))) {
    throw new TypeError(`Evidence ${record.evidenceId} has an invalid date.`);
  }
  const journey = journeyById.get(record.journeyId);
  if (!journey) {
    throw new TypeError(
      `Evidence ${record.evidenceId} names unknown journey ${record.journeyId}.`,
    );
  }
  if (journey.toolId !== record.toolId) {
    throw new TypeError(
      `Journey ${record.journeyId} does not belong to Tool ${record.toolId}.`,
    );
  }
  if (record.reasonCode !== null && !safeIdentity(record.reasonCode)) {
    throw new TypeError(`Evidence ${record.evidenceId} has an unsafe reason.`);
  }
  if (record.outcome !== 'passed' && record.reasonCode === null) {
    throw new TypeError(
      `Evidence ${record.evidenceId} must explain a non-pass outcome.`,
    );
  }
  if (record.outcome === 'passed' && record.reasonCode !== null) {
    throw new TypeError(
      `Evidence ${record.evidenceId} cannot attach a reason to a pass.`,
    );
  }
  const warningCodes = record.warningCodes ?? [];
  if (new Set(warningCodes).size !== warningCodes.length) {
    throw new TypeError(`Evidence ${record.evidenceId} repeats a warning.`);
  }
  for (const warning of warningCodes) {
    if (!safeIdentity(warning)) {
      throw new TypeError(
        `Evidence ${record.evidenceId} has an unsafe warning.`,
      );
    }
  }
  if (new Set(record.checks).size !== record.checks.length) {
    throw new TypeError(`Evidence ${record.evidenceId} repeats a check.`);
  }
  for (const check of record.checks) {
    if (!(requiredVerificationChecks as readonly string[]).includes(check)) {
      throw new TypeError(
        `Evidence ${record.evidenceId} has an unknown check.`,
      );
    }
  }
  for (const [inputId, revision] of Object.entries(record.inputRevisions)) {
    if (!safeIdentity(inputId) || !/^sha256:[a-f0-9]{64}$/.test(revision)) {
      throw new TypeError(
        `Evidence ${record.evidenceId} has an invalid input revision.`,
      );
    }
  }
  if (record.fixture !== null) {
    if (!record.fixture.reference || !sha256(record.fixture.sha256)) {
      throw new TypeError(
        `Evidence ${record.evidenceId} has an invalid fixture identity.`,
      );
    }
  }
}

function compareInputs(
  recorded: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
) {
  const recordedKeys = Object.keys(recorded).sort();
  const currentKeys = Object.keys(current).sort();
  if (
    !recordedKeys.length ||
    recordedKeys.join('\0') !== currentKeys.join('\0')
  ) {
    return 'missing' as const;
  }
  return recordedKeys.every((key) => recorded[key] === current[key])
    ? ('current' as const)
    : ('stale' as const);
}

function project(
  journey: ToolJourney,
  latest: ToolJourneyEvidenceRecord | null,
  currentInputs: Readonly<Record<string, string>>,
): ToolJourneyEvidenceView {
  if (!latest) {
    return deepFreeze({
      journeyId: journey.id,
      state: 'no-evidence' as const,
      latest: null,
      missingChecks: [...requiredVerificationChecks],
      reason: 'No retained controlled evidence exists for this journey.',
    });
  }
  const missingChecks = requiredVerificationChecks.filter(
    (check) => !latest.checks.includes(check),
  );
  const inputs = compareInputs(latest.inputRevisions, currentInputs);
  if (inputs === 'stale') {
    return deepFreeze({
      journeyId: journey.id,
      state: 'stale' as const,
      latest,
      missingChecks,
      reason: 'Relevant journey, fixture, invariant, or policy inputs changed.',
    });
  }
  const baseInvalid =
    latest.revision.dirty ||
    inputs === 'missing' ||
    latest.invariantId === null ||
    latest.invariantId !== journey.semanticInvariant.id ||
    !environmentSatisfies(journey, latest.environment);
  if (baseInvalid) {
    return deepFreeze({
      journeyId: journey.id,
      state: 'invalid' as const,
      latest,
      missingChecks,
      reason:
        'The record does not match the journey fixture, invariant, environment, clean revision, or declared evidence inputs.',
    });
  }
  if (latest.outcome === 'failed') {
    return deepFreeze({
      journeyId: journey.id,
      state: 'failed' as const,
      latest,
      missingChecks,
      reason: `The latest controlled run failed (${latest.reasonCode}).`,
    });
  }
  if (latest.outcome === 'warned') {
    return deepFreeze({
      journeyId: journey.id,
      state: 'warned' as const,
      latest,
      missingChecks,
      reason: `The latest controlled run produced a warning (${latest.reasonCode}).`,
    });
  }
  if (latest.outcome === 'skipped') {
    return deepFreeze({
      journeyId: journey.id,
      state: 'skipped' as const,
      latest,
      missingChecks,
      reason: `The latest controlled run skipped this journey (${latest.reasonCode}).`,
    });
  }
  if (latest.warningCodes?.length) {
    return deepFreeze({
      journeyId: journey.id,
      state: 'warned' as const,
      latest,
      missingChecks,
      reason: `The run emitted warnings (${latest.warningCodes.join(', ')}).`,
    });
  }
  if (
    latest.fixture === null ||
    latest.fixture.reference !== journey.fixture.reference ||
    `sha256:${latest.fixture.sha256}` !== currentInputs['fixture-content']
  ) {
    return deepFreeze({
      journeyId: journey.id,
      state: 'invalid' as const,
      latest,
      missingChecks,
      reason: 'The record does not match the exact journey fixture.',
    });
  }
  if (missingChecks.length) {
    return deepFreeze({
      journeyId: journey.id,
      state: 'incomplete' as const,
      latest,
      missingChecks,
      reason:
        'The run passed, but it did not cover every required verification check.',
    });
  }
  return deepFreeze({
    journeyId: journey.id,
    state: 'verified' as const,
    latest,
    missingChecks: [],
    reason: 'Current controlled evidence satisfies every required check.',
  });
}

export function buildToolVerificationEvidenceIndex(options: BuildOptions) {
  const journeyById = new Map(
    options.journeys.map((journey) => [journey.id, journey]),
  );
  if (journeyById.size !== options.journeys.length) {
    throw new TypeError('Tool Journey evidence identities contain duplicates.');
  }
  const evidenceIds = new Set<string>();
  const runJourneys = new Set<string>();
  const records = options.records.map((record) =>
    deepFreeze(structuredClone(record)),
  );
  for (const record of records) {
    if (evidenceIds.has(record.evidenceId)) {
      throw new TypeError(`Duplicate evidence id: ${record.evidenceId}.`);
    }
    evidenceIds.add(record.evidenceId);
    const runJourney = `${record.runId}\0${record.journeyId}`;
    if (runJourneys.has(runJourney)) {
      throw new TypeError(
        `Duplicate evidence for journey ${record.journeyId} in run ${record.runId}.`,
      );
    }
    runJourneys.add(runJourney);
    validateRecordIdentity(record, journeyById);
  }

  const views = options.journeys.map((journey) => {
    const latest =
      records
        .filter((record) => record.journeyId === journey.id)
        .sort(
          (left, right) =>
            Date.parse(right.observedAt) - Date.parse(left.observedAt),
        )[0] ?? null;
    return project(journey, latest, options.currentInputRevisions(journey));
  });
  const byJourney = new Map(views.map((view) => [view.journeyId, view]));
  const byTool = new Map<string, ToolJourneyEvidenceView[]>();
  for (const journey of options.journeys) {
    const view = byJourney.get(journey.id);
    if (!view) continue;
    byTool.set(journey.toolId, [...(byTool.get(journey.toolId) ?? []), view]);
  }
  const states: ToolJourneyEvidenceState[] = [
    'verified',
    'incomplete',
    'failed',
    'warned',
    'skipped',
    'stale',
    'invalid',
    'no-evidence',
  ];
  const summary = deepFreeze(
    Object.fromEntries(
      states.map((state) => [
        state === 'no-evidence' ? 'noEvidence' : state,
        views.filter((view) => view.state === state).length,
      ]),
    ) as Record<
      Exclude<ToolJourneyEvidenceState, 'no-evidence'> | 'noEvidence',
      number
    >,
  );

  return Object.freeze({
    summary,
    getForJourney(journeyId: string): ToolJourneyEvidenceView {
      return (
        byJourney.get(journeyId) ??
        deepFreeze({
          journeyId,
          state: 'no-evidence' as const,
          latest: null,
          missingChecks: [...requiredVerificationChecks],
          reason: 'Unknown Tool Journey.',
        })
      );
    },
    getForTool(toolId: string): readonly ToolJourneyEvidenceView[] {
      return deepFreeze([...(byTool.get(toolId) ?? [])]);
    },
  });
}

const retainedRecords = retainedRuns.flatMap((manifest) =>
  ingestToolVerificationRun(manifest as unknown as ToolVerificationRunManifest),
);

export const retainedToolVerificationEvidence =
  buildToolVerificationEvidenceIndex({
    journeys: toolJourneys.all,
    records: retainedRecords,
    currentInputRevisions: getToolVerificationInputRevisions,
  });

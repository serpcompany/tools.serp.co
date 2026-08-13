import crypto from 'node:crypto';
import { toolJourneys } from '../../apps/tools/lib/tool-journeys.ts';
import { getToolVerificationInputRevisions } from '../../apps/tools/lib/tool-verification-evidence.ts';

export function buildBrowserScope({ mode, environment, toolIds, filtered }) {
  const selection = filtered ? 'subset' : 'all';
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(toolIds))
    .digest('hex');
  return {
    label: `browser-${mode}-${environment}-${selection}`,
    inputHashes: [`sha256:${digest}`],
    tools: Object.freeze(
      toolIds.map((toolId) =>
        (() => {
          const journeys =
            mode === 'smoke' ? toolJourneys.getBrowserTargets(toolId) : [];
          return Object.freeze({
            toolId,
            journeys: Object.freeze(
              journeys.map((journey) =>
                Object.freeze({
                  journeyId: journey.id,
                  fixtureKind: journey.fixture.kind,
                  fixtureReference: journey.fixture.reference,
                  invariantId: journey.semanticInvariant.id,
                  inputRevisions: getToolVerificationInputRevisions(journey),
                }),
              ),
            ),
          });
        })(),
      ),
    ),
  };
}

export function attachJourneyResultEvidence(tools, results) {
  const resultByToolId = new Map(results.map((result) => [result.id, result]));
  return tools.map((tool) => {
    const result = resultByToolId.get(tool.toolId);
    const journeyResultById = new Map(
      (result?.journeyResults ?? []).map((item) => [item.journeyId, item]),
    );
    return {
      ...tool,
      journeys: tool.journeys.map((journey) => {
        const journeyResult = journeyResultById.get(journey.journeyId) ?? {
          journeyId: journey.journeyId,
          outcome: 'skipped',
          reasonCode: 'journey-result-missing',
          fixtureSha256: null,
        };
        return {
          journeyId: journey.journeyId,
          outcome: journeyResult.outcome,
          reasonCode: journeyResult.reasonCode,
          fixture:
            journey.fixtureReference && journeyResult.fixtureSha256
              ? {
                  kind:
                    journey.fixtureKind === 'literal' ||
                    journey.fixtureKind === 'maintainer-url'
                      ? 'literal'
                      : 'content',
                  reference: journey.fixtureReference,
                  sha256: journeyResult.fixtureSha256,
                }
              : null,
          invariantId: journey.invariantId,
          checks: [...(journeyResult.checks ?? [])],
          inputRevisions: journey.inputRevisions,
        };
      }),
    };
  });
}

export function finalizeJourneyResults({
  plannedJourneys,
  outcomes,
  activeJourneyId,
  status,
}) {
  const outcomeById = new Map(outcomes);
  return plannedJourneys.map((journey) => {
    const exact = outcomeById.get(journey.journeyId);
    if (exact) {
      return {
        journeyId: journey.journeyId,
        ...exact,
        fixtureSha256: journey.fixtureSha256,
      };
    }
    if (activeJourneyId === journey.journeyId) {
      return {
        journeyId: journey.journeyId,
        outcome: 'failed',
        reasonCode: 'browser-check-failed',
        fixtureSha256: journey.fixtureSha256,
      };
    }
    return {
      journeyId: journey.journeyId,
      outcome: 'skipped',
      reasonCode:
        status === 'warn'
          ? 'browser-check-skipped'
          : 'not-executed-after-failure',
      fixtureSha256: journey.fixtureSha256,
    };
  });
}

export function validateBrowserEvidenceRevision(requested, actual) {
  if (requested.revision !== actual.revision) {
    throw new Error('--revision must equal the checked-out Git HEAD');
  }
  if (requested.dirty !== actual.dirty) {
    throw new Error(
      actual.dirty
        ? 'The checkout is dirty; pass --dirty only for local non-promotable evidence'
        : '--dirty cannot describe a clean checkout',
    );
  }
}

export function summarizeNavigationTimings(values) {
  const timings = values
    .filter((value) => Number.isSafeInteger(value) && value >= 0)
    .sort((left, right) => left - right);
  if (timings.length === 0) {
    return {};
  }
  const percentile = (fraction) =>
    timings[Math.max(0, Math.ceil(timings.length * fraction) - 1)];
  return {
    samples: timings.length,
    minMs: timings[0],
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: timings.at(-1),
  };
}

export function classifyConsoleWarning(message) {
  if (
    /target origin provided \('https:\/\/ep2\.adtrafficquality\.google'\).*origin \('null'\)/i.test(
      message,
    ) ||
    /webgl.*(?:driver message|gpu stall)/i.test(message) ||
    /ae_default_editor_active is undefined/i.test(message)
  ) {
    return null;
  }
  if (/adsense.*data-nscript/i.test(message)) {
    return 'adsense-script-attribute';
  }
  if (/ignoring event:\s*localhost/i.test(message)) {
    return 'localhost-event-ignored';
  }
  return 'other-console-warning';
}

export function attachConsoleWarningEvidence(tools, results) {
  const warningsByToolId = new Map(
    results.map((result) => [
      result.id,
      [...new Set(result.consoleWarnings ?? [])].sort(),
    ]),
  );
  return tools.map((tool) => ({
    ...tool,
    warnings: warningsByToolId.get(tool.toolId) ?? [],
  }));
}

import crypto from 'node:crypto';
import { toolJourneys } from '../../apps/tools/lib/tool-journeys.ts';

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
            journeyIds: Object.freeze(journeys.map((journey) => journey.id)),
            invariants: Object.freeze([
              ...new Set(
                journeys
                  .map((journey) => journey.semanticInvariant.id)
                  .filter(Boolean),
              ),
            ]),
          });
        })(),
      ),
    ),
  };
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
  if (/adsense.*data-nscript/i.test(message)) {
    return 'adsense-script-attribute';
  }
  if (/ignoring event:\s*localhost/i.test(message)) {
    return 'localhost-event-ignored';
  }
  if (/webgl.*(?:driver message|gpu stall)/i.test(message)) {
    return 'webgl-driver-performance';
  }
  if (/ae_default_editor_active is undefined/i.test(message)) {
    return 'pdf-editor-default-undefined';
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

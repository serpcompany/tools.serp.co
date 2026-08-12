import crypto from 'node:crypto';

const FULL_SHA = /^[a-f0-9]{40}$/u;
const SCENARIOS = new Set([
  'wrong-target-format',
  'spoofed-input',
  'valid-control',
]);

export const TOOL_WORKFLOW_PROOF_VERSION = '1';

export function validateProofRevisions({
  baseline,
  current,
  head,
  isCommit,
  isAncestor = () => true,
}) {
  if (!FULL_SHA.test(baseline ?? '') || !FULL_SHA.test(current ?? '')) {
    throw new TypeError(
      '--baseline and --current must each be a full 40-character Git commit',
    );
  }
  if (baseline === current) {
    throw new TypeError('--baseline and --current must differ');
  }
  if (current !== head) {
    throw new TypeError('--current must equal the exact commit at HEAD');
  }
  if (!isCommit(baseline) || !isCommit(current)) {
    throw new TypeError('--baseline and --current must resolve to commits');
  }
  if (!isAncestor(baseline, current)) {
    throw new TypeError('--baseline must be an ancestor of --current');
  }
  return { baseline, current };
}

export function detectDeliveryFormat(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (
    input.length >= 12 &&
    input[0] === 0xab &&
    String.fromCharCode(...input.subarray(1, 7)) === 'KTX 20' &&
    input[7] === 0xbb &&
    input[8] === 0x0d &&
    input[9] === 0x0a &&
    input[10] === 0x1a &&
    input[11] === 0x0a
  ) {
    return 'ktx2';
  }
  if (
    input.length >= 8 &&
    input[0] === 0x89 &&
    String.fromCharCode(...input.subarray(1, 4)) === 'PNG' &&
    input[4] === 0x0d &&
    input[5] === 0x0a &&
    input[6] === 0x1a &&
    input[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    input.length >= 12 &&
    String.fromCharCode(...input.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...input.subarray(8, 12)) === 'WEBP'
  ) {
    return 'webp';
  }
  if (input[0] === 0xff && input[1] === 0xd8) return 'jpeg';
  return 'unknown';
}

export function describeDelivery({ name, mimeType, bytes }) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    name,
    mimeType,
    size: input.byteLength,
    sha256: `sha256:${crypto.createHash('sha256').update(input).digest('hex')}`,
    detectedFormat: detectDeliveryFormat(input),
  };
}

export function evaluateBrowserObservation(observation) {
  if (!SCENARIOS.has(observation.scenario)) {
    throw new TypeError(`Unknown proof scenario: ${observation.scenario}`);
  }
  const result = structuredClone(observation);
  if (!Array.isArray(observation.pageErrors)) {
    throw new TypeError('Browser observation must include page errors');
  }
  if (observation.pageErrors.length > 0) {
    return {
      ...result,
      verdict: 'fail',
      reason: `Browser raised ${observation.pageErrors.length} unexpected page error(s).`,
    };
  }
  const deliveryMatches = (format, mimeType, extension) => {
    const delivery = observation.delivery;
    return (
      delivery?.detectedFormat === format &&
      delivery.mimeType === mimeType &&
      typeof delivery.name === 'string' &&
      delivery.name.toLowerCase().endsWith(extension)
    );
  };
  if (observation.scenario === 'wrong-target-format') {
    if (observation.terminal === 'failed' && !observation.delivery) {
      return {
        ...result,
        verdict: 'pass',
        reason: 'Unsupported conversion failed closed without a delivery.',
      };
    }
    if (
      deliveryMatches('ktx2', 'application/octet-stream', '.ktx2') ||
      deliveryMatches('ktx2', 'image/ktx2', '.ktx2')
    ) {
      return {
        ...result,
        verdict: 'pass',
        reason: 'Delivered bytes have the required KTX2 identity.',
      };
    }
    return {
      ...result,
      verdict: 'fail',
      reason:
        observation.delivery?.detectedFormat === 'png'
          ? 'PNG bytes were delivered with a KTX2 filename; the output was mislabeled.'
          : 'The unsupported conversion neither delivered valid KTX2 nor failed closed.',
    };
  }
  if (observation.scenario === 'spoofed-input') {
    if (observation.terminal === 'failed' && !observation.delivery) {
      return {
        ...result,
        verdict: 'pass',
        reason: 'Spoofed input failed closed without a delivery.',
      };
    }
    return {
      ...result,
      verdict: 'fail',
      reason: 'Spoofed input was trusted and produced a delivery.',
    };
  }
  if (
    observation.terminal === 'delivered' &&
    deliveryMatches('webp', 'image/webp', '.webp')
  ) {
    return {
      ...result,
      verdict: 'pass',
      reason: 'Valid PNG control delivered semantically identified WebP bytes.',
    };
  }
  return {
    ...result,
    verdict: 'fail',
    reason: 'Valid PNG control did not deliver semantically identified WebP bytes.',
  };
}

function assertPortfolio(portfolio) {
  const fields = ['active', 'supported', 'unsupported', 'unwired', 'unknown'];
  for (const field of fields) {
    if (!Number.isSafeInteger(portfolio[field]) || portfolio[field] < 0) {
      throw new TypeError(`Portfolio ${field} must be a non-negative integer`);
    }
  }
  if (
    portfolio.supported +
      portfolio.unsupported +
      portfolio.unwired +
      portfolio.unknown !==
    portfolio.active
  ) {
    throw new TypeError('Portfolio partition must equal the active Tool count');
  }
}

export function finalizeComparison({
  baseline,
  current,
  evaluatorRevision,
  generatedAt,
  runtime,
  seamProbes,
  ownership,
  portfolio,
  environment,
  commands,
}) {
  assertPortfolio(portfolio);
  const comparison = {
    schemaVersion: 1,
    status: 'local-proof-pass',
    evaluator: {
      revision: evaluatorRevision,
      version: TOOL_WORKFLOW_PROOF_VERSION,
      generatedAt,
      environment,
      commands,
    },
    revisions: { baseline, current },
    runtime: {
      sameEvaluator: true,
      baseline: runtime.baseline,
      current: runtime.current,
      currentSeamProbes: seamProbes,
    },
    ownership,
    portfolio: {
      ...portfolio,
      supportedPercent: Number(
        ((portfolio.supported / portfolio.active) * 100).toFixed(2),
      ),
    },
    deployment: {
      status: 'unproven',
      reason:
        'This command exercised local revision worktrees only; no deployed target was exercised.',
    },
    conclusion:
      'Safer and centralized locally; this proves neither broad Tool support nor deployed behavior.',
  };
  validateComparison(comparison);
  return comparison;
}

export function validateComparison(value) {
  if (!value || value.schemaVersion !== 1) {
    throw new TypeError('Comparison schemaVersion must be 1');
  }
  if (value.status !== 'local-proof-pass') {
    throw new TypeError('Comparison status must be local-proof-pass');
  }
  if (!FULL_SHA.test(value.evaluator?.revision ?? '')) {
    throw new TypeError('Comparison requires the exact evaluator revision');
  }
  if (
    !FULL_SHA.test(value.revisions?.baseline ?? '') ||
    !FULL_SHA.test(value.revisions?.current ?? '') ||
    value.revisions.baseline === value.revisions.current
  ) {
    throw new TypeError('Comparison requires distinct full revisions');
  }
  if (value.runtime?.sameEvaluator !== true) {
    throw new TypeError('Comparison must use the same evaluator for both revisions');
  }
  if (value.evaluator.revision !== value.revisions.current) {
    throw new TypeError('Evaluator revision must equal the current revision');
  }
  const baseline = value.runtime.baseline;
  const current = value.runtime.current;
  if (!Array.isArray(baseline) || !Array.isArray(current)) {
    throw new TypeError('Comparison requires baseline and current browser replay');
  }
  const expectedScenarios = [...SCENARIOS];
  for (const [label, rows] of [
    ['baseline', baseline],
    ['current', current],
  ]) {
    if (
      rows.length !== expectedScenarios.length ||
      !expectedScenarios.every(
        (scenario) =>
          rows.filter((row) => row.scenario === scenario).length === 1,
      )
    ) {
      throw new TypeError(
        `${label} browser replay must contain every proof scenario exactly once`,
      );
    }
    for (const row of rows) {
      const derived = evaluateBrowserObservation(row);
      if (derived.verdict !== row.verdict || derived.reason !== row.reason) {
        throw new TypeError(
          `${label} browser replay verdict is not derived by the semantic oracle`,
        );
      }
    }
  }
  const baselineByScenario = Object.fromEntries(
    baseline.map((row) => [row.scenario, row]),
  );
  if (
    baselineByScenario['wrong-target-format'].verdict !== 'fail' ||
    baselineByScenario['spoofed-input'].verdict !== 'fail' ||
    baselineByScenario['valid-control'].verdict !== 'pass'
  ) {
    throw new TypeError(
      'Baseline browser replay must falsify both unsafe behaviors while passing the valid control',
    );
  }
  if (!current.every((row) => row.verdict === 'pass')) {
    throw new TypeError('Current browser replay must independently pass every scenario');
  }
  for (const probe of ['lyingProcessor', 'cancellation']) {
    const result = value.runtime.currentSeamProbes?.[probe];
    if (
      result?.verdict !== 'pass' ||
      result.delivered !== false ||
      result.resourcesReleased !== true
    ) {
      throw new TypeError(`Current ${probe} seam probe must pass without delivery`);
    }
  }
  if (
    value.ownership?.baseline?.duplicateImplementationCount <=
      value.ownership?.current?.duplicateImplementationCount ||
    value.ownership.current.duplicateImplementationCount !== 0
  ) {
    throw new TypeError('Ownership comparison must prove duplicate owners fell to zero');
  }
  if (
    value.ownership.current.canonicalLifecycleOwner !==
      'apps/tools/lib/browser-workflow-lifecycle.ts' ||
    value.ownership.current.reachableImplementationCount < 1 ||
    !Array.isArray(value.ownership.current.violations) ||
    value.ownership.current.violations.length !== 0 ||
    !value.ownership.current.familySeamEvidence ||
    Array.isArray(value.ownership.current.familySeamEvidence) ||
    Object.keys(value.ownership.current.familySeamEvidence).length < 1 ||
    !Object.values(value.ownership.current.familySeamEvidence).every(
      (callers) => Array.isArray(callers) && callers.length > 0,
    )
  ) {
    throw new TypeError(
      'Current ownership evidence must retain the canonical owner, zero violations, and proven family workflow seams',
    );
  }
  assertPortfolio(value.portfolio);
  const expectedPercent = Number(
    ((value.portfolio.supported / value.portfolio.active) * 100).toFixed(2),
  );
  if (value.portfolio.supportedPercent !== expectedPercent) {
    throw new TypeError('Portfolio supported percentage is not derived from counts');
  }
  if (value.deployment?.status !== 'unproven') {
    throw new TypeError('Local proof must not claim deployed behavior');
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function browserRows(label, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `<tr><td>${escapeHtml(label)}</td><td colspan="4">No rows</td></tr>`;
  }
  return rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(row.toolId)}</td><td>${escapeHtml(row.scenario)}</td><td class="${row.verdict}">${escapeHtml(row.verdict)}</td><td>${escapeHtml(row.reason)}</td></tr>`,
    )
    .join('\n');
}

export function renderProofReport(comparison) {
  const supportedPercent = Number(comparison.portfolio.supportedPercent).toFixed(
    2,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tool workflow local proof</title>
<style>body{font:16px/1.5 system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#17202a}h1{font-size:2rem}.banner{border:3px solid #a61b1b;background:#fff4f4;padding:1rem;margin:1rem 0}.good{color:#087830}.fail{color:#a61b1b;font-weight:700}.pass{color:#087830;font-weight:700}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #bbb;padding:.55rem;text-align:left;vertical-align:top}code{overflow-wrap:anywhere}</style>
</head><body>
<h1>Safer and centralized locally — limited scope</h1>
<div class="banner"><strong>${supportedPercent}% supported</strong> (${comparison.portfolio.supported} of ${comparison.portfolio.active} active Tool IDs). ${comparison.portfolio.unsupported} are explicitly unsupported, ${comparison.portfolio.unwired} unwired, and ${comparison.portfolio.unknown} unknown.</div>
<div class="banner"><strong>Deployed behavior remains unproven.</strong> ${escapeHtml(comparison.deployment.reason)}</div>
<p>${escapeHtml(comparison.conclusion)}</p>
<h2>Same-oracle browser replay</h2>
<p>Evaluator <code>${escapeHtml(comparison.evaluator.revision)}</code> version ${escapeHtml(comparison.evaluator.version)} replayed both revisions.</p>
<table><thead><tr><th>Revision</th><th>Tool</th><th>Scenario</th><th>Verdict</th><th>Independent semantic reason</th></tr></thead><tbody>
${browserRows(`baseline ${comparison.revisions.baseline.slice(0, 12)}`, comparison.runtime.baseline)}
${browserRows(`current ${comparison.revisions.current.slice(0, 12)}`, comparison.runtime.current)}
</tbody></table>
<h2>Shared lifecycle ownership</h2>
<table><thead><tr><th>Revision</th><th>Reachable shared owners</th><th>Duplicate owners</th></tr></thead><tbody><tr><td>Baseline</td><td>${comparison.ownership.baseline.reachableImplementationCount}</td><td>${comparison.ownership.baseline.duplicateImplementationCount}</td></tr><tr><td>Current</td><td>${comparison.ownership.current.reachableImplementationCount}</td><td>${comparison.ownership.current.duplicateImplementationCount}</td></tr></tbody></table>
<h2>Current public seam probes</h2><pre>${escapeHtml(JSON.stringify(comparison.runtime.currentSeamProbes, null, 2))}</pre>
<h2>Reproduction</h2><pre>${escapeHtml(comparison.evaluator.commands.join('\n'))}</pre>
<p>Generated ${escapeHtml(comparison.evaluator.generatedAt)} on Node ${escapeHtml(comparison.evaluator.environment.node)}, pnpm ${escapeHtml(comparison.evaluator.environment.pnpm)}, ${escapeHtml(comparison.evaluator.environment.platform)}.</p>
</body></html>\n`;
}

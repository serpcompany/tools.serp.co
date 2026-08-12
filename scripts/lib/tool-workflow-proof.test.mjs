import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateBrowserObservation,
  finalizeComparison,
  renderProofReport,
  validateComparison,
  validateProofRevisions,
} from './tool-workflow-proof.mjs';

const BASELINE = 'd4499e333450f5bc501e3842d37deb029717aef4';
const CURRENT = 'adf3a1a613471f16119d8aa6ade992331e14645d';

function observation(overrides = {}) {
  return {
    scenario: 'wrong-target-format',
    toolId: 'bmp-to-ktx2',
    terminal: 'delivered',
    delivery: {
      name: 'sample.ktx2',
      mimeType: 'application/octet-stream',
      size: 12,
      sha256: `sha256:${'a'.repeat(64)}`,
      detectedFormat: 'png',
    },
    visibleMessage: 'Conversion complete!',
    pageErrors: [],
    ...overrides,
  };
}

test('proof revisions are exact, distinct commits and current is HEAD', () => {
  assert.deepEqual(
    validateProofRevisions({
      baseline: BASELINE,
      current: CURRENT,
      head: CURRENT,
      isCommit: () => true,
      isAncestor: () => true,
    }),
    { baseline: BASELINE, current: CURRENT },
  );
  assert.throws(
    () =>
      validateProofRevisions({
        baseline: 'd4499e3',
        current: CURRENT,
        head: CURRENT,
        isCommit: () => true,
        isAncestor: () => true,
      }),
    /full 40-character/i,
  );
  assert.throws(
    () =>
      validateProofRevisions({
        baseline: BASELINE,
        current: BASELINE,
        head: BASELINE,
        isCommit: () => true,
        isAncestor: () => true,
      }),
    /must differ/i,
  );
  assert.throws(
    () =>
      validateProofRevisions({
        baseline: BASELINE,
        current: CURRENT,
        head: BASELINE,
        isCommit: () => true,
        isAncestor: () => true,
      }),
    /current.*HEAD/i,
  );
  assert.throws(
    () =>
      validateProofRevisions({
        baseline: BASELINE,
        current: CURRENT,
        head: CURRENT,
        isCommit: () => true,
        isAncestor: () => false,
      }),
    /ancestor/i,
  );
});

test('same semantic oracle catches a PNG delivered as KTX2 and accepts fail-closed', () => {
  const unsafe = evaluateBrowserObservation(observation());
  assert.equal(unsafe.verdict, 'fail');
  assert.match(unsafe.reason, /PNG bytes.*KTX2/i);

  const safe = evaluateBrowserObservation(
    observation({
      terminal: 'failed',
      delivery: null,
      visibleMessage: 'This Tool is not supported by the verified workflow.',
    }),
  );
  assert.equal(safe.verdict, 'pass');
  assert.match(safe.reason, /failed closed/i);
});

test('spoof and non-regression controls cannot pass the oracle by construction', () => {
  assert.equal(
    evaluateBrowserObservation(
      observation({
        scenario: 'spoofed-input',
        toolId: 'png-to-webp',
        delivery: {
          ...observation().delivery,
          name: 'spoof.webp',
          mimeType: 'image/webp',
          detectedFormat: 'webp',
        },
      }),
    ).verdict,
    'fail',
  );
  assert.equal(
    evaluateBrowserObservation(
      observation({
        scenario: 'valid-control',
        toolId: 'png-to-webp',
        delivery: {
          ...observation().delivery,
          name: 'sample.png',
          mimeType: 'image/png',
          detectedFormat: 'webp',
        },
      }),
    ).verdict,
    'fail',
  );
  assert.equal(
    evaluateBrowserObservation(
      observation({
        scenario: 'valid-control',
        toolId: 'png-to-webp',
        delivery: {
          ...observation().delivery,
          name: 'sample.webp',
          mimeType: 'image/webp',
          detectedFormat: 'png',
        },
      }),
    ).verdict,
    'fail',
  );
  assert.equal(
    evaluateBrowserObservation(
      observation({
        terminal: 'failed',
        delivery: null,
        pageErrors: ['worker crashed'],
      }),
    ).verdict,
    'fail',
  );
});

test('comparison requires the falsifying baseline and independently passing current evidence', () => {
  const runtime = {
    baseline: [
      evaluateBrowserObservation(observation()),
      evaluateBrowserObservation(
        observation({
          scenario: 'spoofed-input',
          toolId: 'png-to-webp',
          delivery: {
            ...observation().delivery,
            name: 'spoof.webp',
            mimeType: 'image/webp',
            detectedFormat: 'webp',
          },
        }),
      ),
      evaluateBrowserObservation(
        observation({
          scenario: 'valid-control',
          toolId: 'png-to-webp',
          delivery: {
            ...observation().delivery,
            name: 'sample.webp',
            mimeType: 'image/webp',
            detectedFormat: 'webp',
          },
        }),
      ),
    ],
    current: [
      evaluateBrowserObservation(
        observation({ terminal: 'failed', delivery: null }),
      ),
      evaluateBrowserObservation(
        observation({
          scenario: 'spoofed-input',
          toolId: 'png-to-webp',
          terminal: 'failed',
          delivery: null,
        }),
      ),
      evaluateBrowserObservation(
        observation({
          scenario: 'valid-control',
          toolId: 'png-to-webp',
          delivery: {
            ...observation().delivery,
            name: 'sample.webp',
            mimeType: 'image/webp',
            detectedFormat: 'webp',
          },
        }),
      ),
    ],
  };
  const comparison = finalizeComparison({
    baseline: BASELINE,
    current: CURRENT,
    evaluatorRevision: CURRENT,
    generatedAt: '2026-08-12T01:02:03.000Z',
    runtime,
    seamProbes: {
      lyingProcessor: { verdict: 'pass', delivered: false, resourcesReleased: true },
      cancellation: { verdict: 'pass', delivered: false, resourcesReleased: true },
    },
    ownership: {
      baseline: { reachableImplementationCount: 22, duplicateImplementationCount: 22, lifecycleInventory: {} },
      current: {
        reachableImplementationCount: 2,
        duplicateImplementationCount: 0,
        canonicalLifecycleOwner: 'apps/tools/lib/browser-workflow-lifecycle.ts',
        lifecycleInventory: {},
        familySeamEvidence: { 'adapter.ts': ['presentation.tsx'] },
        violations: [],
      },
    },
    portfolio: {
      active: 2807,
      supported: 426,
      unsupported: 2378,
      unwired: 0,
      unknown: 3,
    },
    environment: { node: '22.23.1', pnpm: '10.4.1', platform: 'darwin-arm64' },
    commands: ['proof:tool-workflow'],
  });
  assert.equal(comparison.status, 'local-proof-pass');
  assert.equal(comparison.deployment.status, 'unproven');
  assert.equal(comparison.portfolio.supportedPercent, 15.18);
  assert.doesNotThrow(() => validateComparison(comparison));

  const tampered = structuredClone(comparison);
  tampered.runtime.current[2].verdict = 'fail';
  assert.throws(() => validateComparison(tampered), /current browser replay/i);

  const forged = structuredClone(comparison);
  forged.runtime.baseline[0].delivery.detectedFormat = 'ktx2';
  assert.throws(() => validateComparison(forged), /semantic oracle/i);
});

test('HTML report is derived, prominent about limited support, and cannot hide unproven deployment', () => {
  const report = renderProofReport({
    schemaVersion: 1,
    status: 'local-proof-pass',
    evaluator: {
      revision: CURRENT,
      version: '1',
      generatedAt: '2026-08-12T01:02:03.000Z',
      environment: { node: '22.23.1', pnpm: '10.4.1', platform: 'darwin-arm64' },
      commands: ['proof:tool-workflow'],
    },
    revisions: { baseline: BASELINE, current: CURRENT },
    runtime: { sameEvaluator: true, baseline: [], current: [], currentSeamProbes: {} },
    ownership: {
      baseline: { reachableImplementationCount: 22, duplicateImplementationCount: 22, lifecycleInventory: {} },
      current: { reachableImplementationCount: 2, duplicateImplementationCount: 0, lifecycleInventory: {} },
    },
    portfolio: { active: 2807, supported: 426, unsupported: 2378, unwired: 0, unknown: 3, supportedPercent: 15.18 },
    deployment: { status: 'unproven', reason: 'No deployed target was exercised.' },
    conclusion: 'Safer and centralized locally; not broad support or deployed proof.',
  });
  assert.match(report, /Safer and centralized/i);
  assert.match(report, /15\.18% supported/i);
  assert.match(report, /deployed behavior.*unproven/i);
  assert.doesNotMatch(report, /<script/i);
});

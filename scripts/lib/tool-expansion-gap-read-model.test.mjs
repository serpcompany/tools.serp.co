import assert from 'node:assert/strict';
import test from 'node:test';

import { createToolExpansionGapReadModel } from './tool-expansion-gap-read-model.mjs';

const source = 'fixture:accepted-specification';

function row(id, disposition, overrides = {}) {
  return {
    toolId: id,
    acceptedDisposition: disposition,
    evidence: {
      catalogIntent: {
        operation: disposition === 'unsupported' ? 'convert' : 'view',
        renderer: disposition === 'unsupported' ? 'generic' : 'pdf',
        inputFormat: disposition === 'unsupported' ? 'png' : null,
        outputFormat: disposition === 'unsupported' ? 'jxl' : null,
        source,
      },
      processorAvailability: {
        kind: disposition === 'supported' ? 'wired' : 'unwired',
        adapterId: disposition === 'supported' ? 'fixture-adapter' : null,
        source,
      },
      implementationProvenance: {
        kind: 'mapped',
        engineIds: ['fixture-engine'],
        source,
      },
      exactDispatchCapability: {
        key:
          disposition === 'unsupported'
            ? 'browser-raster:unsupported'
            : 'not-applicable',
        capable: disposition === 'supported' ? true : false,
        source,
      },
      controlledVerification: {
        classification:
          disposition === 'supported' ? 'contract-verified' : 'not-verified',
        source,
      },
    },
    blockers:
      disposition === 'unsupported'
        ? [
            {
              code: 'no-production-adapter',
              detail: 'No exact adapter.',
              source,
            },
          ]
        : [],
    planning: {
      inputFamily: disposition === 'unsupported' ? 'raster-image' : 'document',
      outputFamily: disposition === 'unsupported' ? 'raster-image' : 'document',
      processorFamily:
        disposition === 'unsupported' ? 'generic:browser-raster' : 'pdf',
      feasibility: {
        classification:
          disposition === 'unsupported'
            ? 'new-maintained-dependency'
            : 'existing-maintained-engine',
        rationale: 'Fixture planning assumption.',
        source: 'planning-policy:fixture',
      },
      priority: {
        score: 0,
        rationale: 'Not ranked.',
        source: 'planning-policy:fixture',
      },
      source: 'planning-policy:fixture',
    },
    ...overrides,
  };
}

test('read model exposes one immutable lookup and deterministic unsupported groups', () => {
  const model = createToolExpansionGapReadModel({
    baselineRevision: 'a'.repeat(40),
    rows: [
      row('z-supported', 'supported'),
      row('b-gap', 'unsupported'),
      row('a-gap', 'unsupported'),
    ],
    expectedCounts: { supported: 1, unsupported: 2, unwired: 0, unknown: 0 },
    recommendations: [],
  });

  assert.equal(model.getByToolId('missing'), null);
  assert.equal(model.getByToolId('a-gap')?.toolId, 'a-gap');
  assert.throws(() => {
    model.getByToolId('a-gap').blockers.push({});
  }, TypeError);

  const grouped = model.groupUnsupported();
  assert.deepEqual(
    grouped.byRenderer.map(({ key, toolIds }) => ({ key, toolIds })),
    [{ key: 'generic', toolIds: ['a-gap', 'b-gap'] }],
  );
  assert.match(grouped.byRenderer[0].membershipSha256, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(model.toProjection().portfolio.counts, {
    supported: 1,
    unsupported: 2,
    unwired: 0,
    unknown: 0,
  });
});

test('read model rejects duplicate, missing-blocker, and collapsed evidence inputs', () => {
  const args = {
    baselineRevision: 'a'.repeat(40),
    expectedCounts: { supported: 0, unsupported: 1, unwired: 0, unknown: 0 },
    recommendations: [],
  };
  assert.throws(
    () =>
      createToolExpansionGapReadModel({
        ...args,
        rows: [row('same', 'unsupported'), row('same', 'unsupported')],
      }),
    /duplicate Tool id: same/,
  );
  assert.throws(
    () =>
      createToolExpansionGapReadModel({
        ...args,
        rows: [row('gap', 'unsupported', { blockers: [] })],
      }),
    /must name at least one blocker/,
  );
  assert.throws(
    () =>
      createToolExpansionGapReadModel({
        ...args,
        rows: [{ ...row('gap', 'unsupported'), status: 'broken' }],
      }),
    /must not collapse evidence into status/,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolExpansionGapReadModel } from './build-tool-expansion-gap.mjs';
import { toolAcceptanceClaims } from '../../apps/tools/lib/tool-acceptance-claims.ts';

const baselineRevision = 'd3e6c4c44af0d0a6a8e243f4a4e61963bb838e87';

test('accepted baseline is accounted for once with exact gap partitions and source-named facts', () => {
  const projection = buildToolExpansionGapReadModel({
    baselineRevision,
  }).toProjection();

  assert.equal(projection.portfolio.activeToolCount, 2_807);
  assert.equal(
    projection.portfolio.activeToolIdsSha256,
    'sha256:fadb77ac2e1c68c14863a3ebd4ca43cde6692e9bde72bfacaf1026b8baeda030',
  );
  assert.deepEqual(projection.portfolio.counts, {
    supported: 439,
    unsupported: 2_365,
    unwired: 0,
    unknown: 3,
  });
  assert.equal(
    projection.portfolio.memberships,
    toolAcceptanceClaims.memberships,
  );
  assert.equal(new Set(projection.rows.map((row) => row.toolId)).size, 2_807);
  assert.equal(
    projection.rows.every((row) => {
      const claim = toolAcceptanceClaims.getByToolId(row.toolId);
      return (
        row.acceptedDisposition === claim?.disposition &&
        row.evidence.acceptanceClaim.disposition === claim.disposition &&
        row.evidence.acceptanceClaim.reason === claim.reason &&
        row.evidence.acceptanceClaim.sourceNeeded === claim.sourceNeeded &&
        row.evidence.acceptanceClaim.sourcePointers === claim.sourcePointers
      );
    }),
    true,
  );
  assert.deepEqual(
    Object.fromEntries(
      projection.unsupportedGroups.byRenderer.map(({ key, count }) => [
        key,
        count,
      ]),
    ),
    { generic: 2306, table: 59 },
  );
  assert.equal(
    projection.rows.filter(
      (row) =>
        row.acceptedDisposition === 'unsupported' &&
        row.evidence.catalogIntent.operation === 'convert',
    ).length,
    2_347,
  );
  assert.equal(
    projection.rows.filter(
      (row) =>
        row.acceptedDisposition === 'unsupported' &&
        row.evidence.catalogIntent.operation === 'compress',
    ).length,
    18,
  );
  for (const row of projection.rows.filter(
    (entry) => entry.acceptedDisposition !== 'supported',
  )) {
    assert.ok(row.blockers.length > 0, row.toolId);
    assert.ok(
      row.blockers.every((blocker) => blocker.source),
      row.toolId,
    );
  }
  for (const row of projection.rows.filter(
    (entry) => entry.acceptedDisposition === 'unknown',
  )) {
    assert.ok(row.evidence.implementationProvenance.sourceNeeded, row.toolId);
    assert.ok(row.blockers[0].resolutionPath, row.toolId);
  }
});

test('planning remains visibly separate and recommends three bounded exact-membership waves', () => {
  const projection = buildToolExpansionGapReadModel({
    baselineRevision,
  }).toProjection();
  assert.deepEqual(
    [
      ...new Set(
        projection.rows.map((row) => row.planning.feasibility.classification),
      ),
    ].sort(),
    [
      'existing-maintained-engine',
      'invalid-or-duplicate-catalog-intent',
      'native-or-server-infrastructure',
      'new-maintained-dependency',
      'unresolved',
    ],
  );
  assert.deepEqual(
    projection.recommendations.map(({ id, count, expectedCoverageDelta }) => ({
      id,
      count,
      expectedCoverageDelta,
    })),
    [
      {
        id: 'browser-raster-exact-capability',
        count: 28,
        expectedCoverageDelta: 28,
      },
      {
        id: 'table-raster-semantic-validator',
        count: 13,
        expectedCoverageDelta: 13,
      },
      {
        id: 'server-image-exact-capability',
        count: 78,
        expectedCoverageDelta: 78,
      },
    ],
  );
  for (const recommendation of projection.recommendations) {
    assert.equal(recommendation.toolIds.length, recommendation.count);
    assert.match(recommendation.membershipSha256, /^sha256:[a-f0-9]{64}$/);
    assert.ok(recommendation.dependencies.length > 0);
    assert.ok(recommendation.risks.length > 0);
    assert.ok(recommendation.semanticTestStrategy.length > 0);
  }
});

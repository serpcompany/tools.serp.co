import crypto from 'node:crypto';

const dispositions = Object.freeze([
  'supported',
  'unsupported',
  'unwired',
  'unknown',
]);
const groupDimensions = Object.freeze({
  byRenderer: (row) => row.evidence.catalogIntent.renderer,
  byExactDispatchCapability: (row) => row.evidence.exactDispatchCapability.key,
  byInputOutputFamily: (row) =>
    `${row.planning.inputFamily}->${row.planning.outputFamily}`,
  byProcessorFamily: (row) => row.planning.processorFamily,
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function membershipSha256(toolIds) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(toolIds)).digest('hex')}`;
}

function groupRows(rows, keyFor) {
  const byKey = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    const toolIds = byKey.get(key) ?? [];
    toolIds.push(row.toolId);
    byKey.set(key, toolIds);
  }
  return Object.freeze(
    [...byKey]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, ids]) => {
        const toolIds = Object.freeze([...ids].sort());
        return Object.freeze({
          key,
          count: toolIds.length,
          membershipSha256: membershipSha256(toolIds),
          toolIds,
        });
      }),
  );
}

function requireNamedSource(value, location) {
  if (typeof value?.source !== 'string' || value.source.length === 0) {
    throw new TypeError(`${location} must name its source`);
  }
}

function validateRow(row, seen) {
  if (!row || typeof row.toolId !== 'string' || row.toolId.length === 0) {
    throw new TypeError('Every row must name a Tool id');
  }
  if (seen.has(row.toolId))
    throw new TypeError(`duplicate Tool id: ${row.toolId}`);
  seen.add(row.toolId);
  if (Object.hasOwn(row, 'status') || Object.hasOwn(row, 'health')) {
    throw new TypeError(
      `${row.toolId} must not collapse evidence into status or health`,
    );
  }
  if (!dispositions.includes(row.acceptedDisposition)) {
    throw new TypeError(`${row.toolId} has an invalid accepted disposition`);
  }
  for (const [name, fact] of Object.entries(row.evidence ?? {})) {
    requireNamedSource(fact, `${row.toolId}.evidence.${name}`);
  }
  requireNamedSource(
    row.planning?.feasibility,
    `${row.toolId}.planning.feasibility`,
  );
  requireNamedSource(row.planning?.priority, `${row.toolId}.planning.priority`);
  requireNamedSource(row.planning, `${row.toolId}.planning`);
  if (
    row.acceptedDisposition !== 'supported' &&
    (!Array.isArray(row.blockers) || row.blockers.length === 0)
  ) {
    throw new TypeError(`${row.toolId} must name at least one blocker`);
  }
  for (const [index, blocker] of (row.blockers ?? []).entries()) {
    requireNamedSource(blocker, `${row.toolId}.blockers[${index}]`);
  }
}

function validateRecommendation(recommendation, unsupportedIds) {
  const sorted = [...recommendation.toolIds].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(recommendation.toolIds)) {
    throw new TypeError(`${recommendation.id} Tool ids must be sorted`);
  }
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${recommendation.id} repeats a Tool id`);
  }
  for (const toolId of sorted) {
    if (!unsupportedIds.has(toolId)) {
      throw new TypeError(
        `${recommendation.id} includes non-unsupported Tool ${toolId}`,
      );
    }
  }
  if (recommendation.count !== sorted.length) {
    throw new TypeError(`${recommendation.id} count does not match membership`);
  }
  if (recommendation.membershipSha256 !== membershipSha256(sorted)) {
    throw new TypeError(`${recommendation.id} membership hash does not match`);
  }
}

export function createToolExpansionGapReadModel({
  baselineRevision,
  rows,
  expectedCounts,
  recommendations,
  referenceData = {},
  reproducerSourceRevision = baselineRevision,
}) {
  if (!/^[a-f0-9]{40}$/.test(baselineRevision ?? '')) {
    throw new TypeError('baselineRevision must be a full commit SHA');
  }
  const seen = new Set();
  rows.forEach((row) => validateRow(row, seen));
  const sortedRows = Object.freeze(
    [...rows]
      .sort((left, right) => left.toolId.localeCompare(right.toolId))
      .map(deepFreeze),
  );
  const rowsById = new Map(sortedRows.map((row) => [row.toolId, row]));
  const toolIdsByDisposition = Object.freeze(
    Object.fromEntries(
      dispositions.map((disposition) => [
        disposition,
        Object.freeze(
          sortedRows
            .filter((row) => row.acceptedDisposition === disposition)
            .map((row) => row.toolId),
        ),
      ]),
    ),
  );
  const counts = Object.freeze(
    Object.fromEntries(
      dispositions.map((disposition) => [
        disposition,
        toolIdsByDisposition[disposition].length,
      ]),
    ),
  );
  if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) {
    throw new TypeError(
      `Disposition counts drifted: expected ${JSON.stringify(expectedCounts)}, received ${JSON.stringify(counts)}`,
    );
  }
  const unsupportedRows = sortedRows.filter(
    (row) => row.acceptedDisposition === 'unsupported',
  );
  const unsupportedGroups = deepFreeze(
    Object.fromEntries(
      Object.entries(groupDimensions).map(([dimension, keyFor]) => [
        dimension,
        groupRows(unsupportedRows, keyFor),
      ]),
    ),
  );
  const unsupportedIds = new Set(toolIdsByDisposition.unsupported);
  recommendations.forEach((recommendation) =>
    validateRecommendation(recommendation, unsupportedIds),
  );
  const frozenRecommendations = Object.freeze(recommendations.map(deepFreeze));
  const allToolIds = Object.freeze(sortedRows.map((row) => row.toolId));
  const projection = deepFreeze({
    schemaVersion: 1,
    evidenceScope: {
      portfolioBaselineRevision: baselineRevision,
      reproducerSourceRevision,
      environment: 'local-versioned-sources',
      productionAccess: false,
      definition:
        'Planning and controlled capability evidence only; this projection is not deployed availability or runtime health.',
    },
    portfolio: {
      activeToolCount: allToolIds.length,
      activeToolIdsSha256: membershipSha256(allToolIds),
      counts,
      toolIdsByDisposition,
    },
    rows: sortedRows,
    referenceData,
    unsupportedGroups,
    recommendations: frozenRecommendations,
  });

  return Object.freeze({
    getByToolId(toolId) {
      return rowsById.get(toolId) ?? null;
    },
    groupUnsupported() {
      return unsupportedGroups;
    },
    toProjection() {
      return projection;
    },
  });
}

export function createMembership(toolIds) {
  const sortedIds = Object.freeze([...toolIds].sort());
  return Object.freeze({
    count: sortedIds.length,
    membershipSha256: membershipSha256(sortedIds),
    toolIds: sortedIds,
  });
}

const ACCEPTANCE_STATES = Object.freeze([
  'supported',
  'unsupported',
  'unwired',
  'unknown',
]);

export function classifyToolAcceptance({
  availabilityKind,
  renderer,
  genericContractState,
  tablePolicyKind,
}) {
  if (availabilityKind === 'wired') return 'supported';
  if (
    (renderer === 'generic' && genericContractState === 'unsupported') ||
    (renderer === 'table' && tablePolicyKind === 'unsupported')
  ) {
    return 'unsupported';
  }
  if (availabilityKind === 'unknown') return 'unknown';
  return 'unwired';
}

export function summarizeToolAcceptance(rows) {
  const classified = rows.map((row) => ({
    ...row,
    acceptance: classifyToolAcceptance(row),
  }));
  return Object.freeze({
    counts: Object.freeze(
      Object.fromEntries(
        ACCEPTANCE_STATES.map((state) => [
          state,
          classified.filter((row) => row.acceptance === state).length,
        ]),
      ),
    ),
    toolIds: Object.freeze(
      Object.fromEntries(
        ACCEPTANCE_STATES.map((state) => [
          state,
          Object.freeze(
            classified
              .filter((row) => row.acceptance === state)
              .map((row) => row.id)
              .sort(),
          ),
        ]),
      ),
    ),
  });
}

function number(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function groupTable(groups, pointer) {
  const lines = [
    '| Key | Count | Membership SHA-256 | JSON pointer |',
    '| --- | ---: | --- | --- |',
  ];
  groups.forEach((group, index) => {
    lines.push(
      `| ${escapeTable(group.key)} | ${number(group.count)} | \`${group.membershipSha256}\` | \`${pointer}/${index}\` |`,
    );
  });
  return lines.join('\n');
}

function recommendationSection(recommendation) {
  return `### ${recommendation.title}

- Candidate id: \`${recommendation.id}\`
- Exact membership: ${number(recommendation.count)} Tool ids (\`${recommendation.membershipSha256}\`)
- Expected controlled coverage delta: +${number(recommendation.expectedCoverageDelta)}; 426 → ${number(recommendation.expectedSupportedCount)} if and only if every member passes the family acceptance gate
- Dependencies: ${recommendation.dependencies.join('; ')}
- Risks: ${recommendation.risks.join('; ')}
- Semantic-test strategy: ${recommendation.semanticTestStrategy}
- Exact sorted Tool ids: ${recommendation.toolIds.map((toolId) => `\`${toolId}\``).join(', ')}
`;
}

export function renderToolExpansionGapReport(projection) {
  const counts = projection.portfolio.counts;
  const conversionGaps = projection.rows.filter(
    (row) =>
      row.acceptedDisposition === 'unsupported' &&
      row.evidence.catalogIntent.operation === 'convert',
  ).length;
  const compressionGaps = projection.rows.filter(
    (row) =>
      row.acceptedDisposition === 'unsupported' &&
      row.evidence.catalogIntent.operation === 'compress',
  ).length;
  const feasibilityCounts = Object.entries(
    projection.rows
      .filter((row) => row.acceptedDisposition !== 'supported')
      .reduce((result, row) => {
        const key = row.planning.feasibility.classification;
        result[key] = (result[key] ?? 0) + 1;
        return result;
      }, {}),
  ).sort(([left], [right]) => left.localeCompare(right));

  return `# Tool processor expansion-gap evidence

This report indexes the deterministic JSON projection produced for GitHub issue
#87. Its portfolio baseline is exact revision
\`${projection.evidenceScope.portfolioBaselineRevision}\`.

This is local, versioned planning and controlled-capability evidence. Production was not queried,
and no deployed availability or runtime health is asserted.
Planning assumptions are not measured evidence.

## Portfolio invariant

- ${number(projection.portfolio.activeToolCount)} active Tool ids
- ${number(counts.supported)} supported | ${number(counts.unsupported)} unsupported | ${number(counts.unwired)} unwired | ${number(counts.unknown)} unknown
- Active membership: \`${projection.portfolio.activeToolIdsSha256}\`

| Gap partition | Count |
| --- | ---: |
| Conversion gaps | ${number(conversionGaps)} |
| Compression gaps | ${number(compressionGaps)} |

Every active Tool appears exactly once in JSON at \`/rows\`. Exact disposition
memberships live at \`/portfolio/toolIdsByDisposition\`; individual facts name
their source, while feasibility and priority live separately under \`planning\`.

## Unsupported index by renderer

${groupTable(projection.unsupportedGroups.byRenderer, '/unsupportedGroups/byRenderer')}

## Unsupported index by exact dispatch/capability

${groupTable(projection.unsupportedGroups.byExactDispatchCapability, '/unsupportedGroups/byExactDispatchCapability')}

## Unsupported index by input/output family

${groupTable(projection.unsupportedGroups.byInputOutputFamily, '/unsupportedGroups/byInputOutputFamily')}

## Unsupported index by processor family

${groupTable(projection.unsupportedGroups.byProcessorFamily, '/unsupportedGroups/byProcessorFamily')}

## Feasibility assumptions

These classifications are a deterministic planning policy, not proof that an
engine supports an exact Tool operation.

| Classification | Gap Tool ids |
| --- | ---: |
${feasibilityCounts.map(([key, count]) => `| ${escapeTable(key)} | ${number(count)} |`).join('\n')}

## Three bounded candidate waves

${projection.recommendations.map(recommendationSection).join('\n')}
## Reproduction

From a fresh clone at a revision whose consumed product inputs match the
accepted baseline, using the supported Node runtime:

\`\`\`sh
mise exec node@22.23.1 -- pnpm --silent audit:tool-expansion-gap -- --source-revision ${projection.evidenceScope.reproducerSourceRevision} --format json
mise exec node@22.23.1 -- pnpm --silent audit:tool-expansion-gap -- --source-revision ${projection.evidenceScope.reproducerSourceRevision} --format report
\`\`\`

The JSON projection is the complete read model. This Markdown document is its
concise human index; hashes make Catalog membership drift loud.
`;
}

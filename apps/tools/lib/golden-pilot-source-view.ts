import { fileURLToPath } from 'node:url';

import { buildGoldenToolJourneyPilotView } from './golden-tool-journey-pilot.ts';
import { buildToolClientFirstPlan } from './tool-client-first-plan.ts';
import { buildToolExpansionPlan } from './tool-expansion-planner.ts';
import { buildToolFactoryReadModel } from './tool-factory-read-model.ts';
import { journeyEvidenceLabel } from './tool-verification-presentation.ts';

export function buildGoldenPilotSourceView() {
  const tools = buildToolFactoryReadModel();
  const clientFirst = buildToolClientFirstPlan(tools.rows);
  const expansion = buildToolExpansionPlan(tools.rows);
  const firstExpansionGroup = expansion.groups[0];
  if (!firstExpansionGroup) {
    throw new TypeError('Tool expansion plan must contain a ranked group.');
  }
  const excludedExpansionTool = tools.rows.find(
    (row) =>
      row.support.disposition === 'supported' &&
      !firstExpansionGroup.toolIds.includes(row.toolId),
  );
  if (!excludedExpansionTool) {
    throw new TypeError(
      'Tool expansion projection requires a supported Tool outside rank one.',
    );
  }
  return Object.freeze({
    ...buildGoldenToolJourneyPilotView(tools.rows, clientFirst.rows),
    portfolioCounts: tools.counts,
    portfolioTotal: tools.rows.length,
    firstExpansionGroup: Object.freeze({
      id: firstExpansionGroup.id,
      rank: firstExpansionGroup.rank,
      operationFamily: firstExpansionGroup.operationFamily,
      unlockCount: firstExpansionGroup.unlockCount,
      candidateEngineIdentities: Object.freeze(
        firstExpansionGroup.candidateEngines.map((engine) => engine.identity),
      ),
      includedToolId: firstExpansionGroup.toolIds[0],
      excludedToolId: excludedExpansionTool.toolId,
    }),
    evidenceCards: Object.freeze(
      tools.rows.flatMap((row) =>
        row.verificationEvidence.map((evidence) =>
          Object.freeze({
            journeyId: evidence.journeyId,
            state: evidence.state,
            label: journeyEvidenceLabel(evidence.state),
            reason: evidence.reason,
          }),
        ),
      ),
    ),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(buildGoldenPilotSourceView())}\n`);
}

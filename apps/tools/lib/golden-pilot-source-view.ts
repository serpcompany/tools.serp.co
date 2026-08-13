import { fileURLToPath } from 'node:url';

import { buildGoldenToolJourneyPilotView } from './golden-tool-journey-pilot.ts';
import { buildToolClientFirstPlan } from './tool-client-first-plan.ts';
import { buildToolFactoryReadModel } from './tool-factory-read-model.ts';

export function buildGoldenPilotSourceView() {
  const tools = buildToolFactoryReadModel();
  const clientFirst = buildToolClientFirstPlan(tools.rows);
  return buildGoldenToolJourneyPilotView(tools.rows, clientFirst.rows);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(buildGoldenPilotSourceView())}\n`);
}

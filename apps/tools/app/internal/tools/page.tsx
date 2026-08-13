import { getCloudflareContext } from '@opennextjs/cloudflare';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import {
  authorizeToolFactoryRequest,
  getToolFactoryAccessConfig,
  getToolFactoryDeployment,
} from '../../../lib/tool-factory-access.ts';
import { buildToolExpansionPlan } from '../../../lib/tool-expansion-planner.ts';
import { buildToolClientFirstPlan } from '../../../lib/tool-client-first-plan.ts';
import { buildToolFactoryReadModel } from '../../../lib/tool-factory-read-model.ts';
import { buildGoldenToolJourneyPilotView } from '../../../lib/golden-tool-journey-pilot.ts';
import { getSerpToolsD1Binding } from '../../../lib/cloudflare-d1.ts';
import { loadToolRuntimeObservations } from '../../../lib/tool-runtime-observations.ts';
import { ToolFactoryTable } from './tool-factory-table.tsx';

export const dynamic = 'force-dynamic';

async function runtimeEnvironment() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return { ...process.env, ...(env as Record<string, string | undefined>) };
  } catch {
    return process.env;
  }
}

export default async function ToolFactoryPage() {
  const environment = await runtimeEnvironment();
  const deployment = getToolFactoryDeployment(environment);
  if (!deployment) notFound();

  if (deployment.requiresAccess) {
    const access = getToolFactoryAccessConfig(environment);
    const token = (await headers()).get('cf-access-jwt-assertion') ?? '';
    if (!access || !(await authorizeToolFactoryRequest(token, access))) {
      notFound();
    }
  }

  const model = buildToolFactoryReadModel();
  const clientFirstPlan = buildToolClientFirstPlan(model.rows);
  const goldenPilot = buildGoldenToolJourneyPilotView(
    model.rows,
    clientFirstPlan.rows,
  );
  const expansionPlan = buildToolExpansionPlan(model.rows);
  const runtimeObservations = await loadToolRuntimeObservations(
    deployment.environment === 'DEV/STAGING'
      ? await getSerpToolsD1Binding()
      : null,
    {
      environment: deployment.environment,
      sourceOrigin: environment.NEXT_PUBLIC_SITE_URL ?? '',
      toolIds: model.rows.map((row) => row.toolId),
      now: new Date(),
    },
  );
  return (
    <ToolFactoryTable
      deployment={deployment}
      model={{ rows: model.rows, counts: model.counts }}
      clientFirstPlan={{ rows: clientFirstPlan.rows }}
      goldenPilot={goldenPilot}
      expansionPlan={expansionPlan}
      runtimeObservations={runtimeObservations}
    />
  );
}

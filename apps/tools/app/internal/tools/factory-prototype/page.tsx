import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { notFound } from 'next/navigation';

import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import {
  FactoryPrototype,
  type PrototypeData,
  type Recommendation,
} from './prototype-client';

export const dynamic = 'force-dynamic';

const PROTOTYPE_REVISION = 'b6390254430d6baf49fa79df16b04eed64230d7b';

type ProjectionEngine = {
  id: string;
  processingLocation: string;
  implementation: { identity: string };
};

type ProjectionRow = {
  toolId: string;
  acceptedDisposition: string;
  evidence: {
    catalogIntent: {
      route: string;
      operation: string;
      inputFormat: string | null;
      outputFormat: string | null;
      renderer: string;
    };
    implementationProvenance: { engineIds: string[] };
    runtimeCompatibility: {
      executionProfiles: string[];
      classification: string;
      reason: string;
    };
    controlledVerification: { classification: string; reason: string };
    processorAvailability: { adapterId: string | null };
  };
  blockers: { code: string; detail: string }[];
  planning: {
    processorFamily: string;
    feasibility: { classification: string };
    priority: { score: number };
  };
};

type ExpansionProjection = {
  evidenceScope: PrototypeData['scope'];
  portfolio: PrototypeData['portfolio'];
  rows: ProjectionRow[];
  recommendations: Recommendation[];
  referenceData: { executionEngines: ProjectionEngine[] };
};

let projectionCache: ExpansionProjection | undefined;

function loadProjection() {
  if (projectionCache) return projectionCache;
  const runner = path.resolve(
    process.cwd(),
    'app/internal/tools/factory-prototype/projection-runner.mjs',
  );
  const result = spawnSync(process.execPath, [runner], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `Prototype projection failed: ${result.stderr.trim() || 'unknown failure'}`,
    );
  }
  projectionCache = JSON.parse(result.stdout) as ExpansionProjection;
  return projectionCache;
}

export default function ToolFactoryPrototypePage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const projection = loadProjection();
  const catalogById = new Map(
    toolCatalog.activeTools.map((tool) => [tool.id, tool]),
  );
  const engineById = new Map(
    projection.referenceData.executionEngines.map((engine) => [
      engine.id,
      engine,
    ]),
  );

  const rows = projection.rows.map((row) => {
    const tool = catalogById.get(row.toolId);
    const engines = row.evidence.implementationProvenance.engineIds
      .map((engineId) => engineById.get(engineId))
      .filter((engine) => engine !== undefined);
    return {
      id: row.toolId,
      name: tool?.name ?? row.toolId,
      description: tool?.description ?? 'No Catalog description.',
      route: row.evidence.catalogIntent.route,
      operation: row.evidence.catalogIntent.operation,
      from: row.evidence.catalogIntent.inputFormat,
      to: row.evidence.catalogIntent.outputFormat,
      renderer: row.evidence.catalogIntent.renderer,
      disposition: row.acceptedDisposition,
      family: row.planning.processorFamily,
      libraries: engines.map((engine) => engine.implementation.identity),
      engineIds: engines.map((engine) => engine.id),
      processingLocations: [
        ...new Set(engines.map((engine) => engine.processingLocation)),
      ],
      executionProfiles: row.evidence.runtimeCompatibility.executionProfiles,
      runtimeFit: row.evidence.runtimeCompatibility.classification,
      runtimeReason: row.evidence.runtimeCompatibility.reason,
      verification: row.evidence.controlledVerification.classification,
      verificationReason: row.evidence.controlledVerification.reason,
      adapter: row.evidence.processorAvailability.adapterId,
      blockers: row.blockers.map((blocker) => ({
        code: blocker.code,
        detail: blocker.detail,
      })),
      feasibility: row.planning.feasibility.classification,
      priority: row.planning.priority.score,
    };
  });

  return (
    <FactoryPrototype
      data={{
        revision: PROTOTYPE_REVISION,
        scope: projection.evidenceScope,
        portfolio: projection.portfolio,
        rows,
      }}
    />
  );
}

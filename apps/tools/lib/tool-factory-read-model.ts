import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import { resolveCompressionDispatch } from './compression-utils.ts';
import { resolveConversionDispatch } from './convert/conversion-dispatch.ts';
import {
  toolAcceptanceClaims,
  type ToolAcceptanceClaim,
  type ToolAcceptanceClaims,
  type ToolAcceptanceDisposition,
} from './tool-acceptance-claims.ts';
import {
  executionProvenance,
  getToolExecutionProvenance,
  type ExecutionProfile,
} from './tool-execution-provenance.ts';
import { selectToolRenderer } from './tool-renderer.ts';
import { toolJourneys, type ToolJourney } from './tool-journeys.ts';
import {
  buildToolGithubWorkIndex,
  retainedToolGithubWorkSnapshot,
  type ToolGithubWorkView,
} from './tool-github-work-links.ts';
import {
  retainedToolVerificationEvidence,
  type ToolJourneyEvidenceView,
} from './tool-verification-evidence.ts';

export type ToolSupportDisposition = ToolAcceptanceDisposition;

export type ToolFactoryRow = Readonly<{
  toolId: string;
  name: string;
  description: string;
  route: string;
  catalogIntent: Readonly<{
    operation: string;
    inputFormat: string | null;
    outputFormat: string | null;
    renderer: string;
    tags: readonly string[];
    priority: number | null;
    isBeta: boolean;
    isNew: boolean;
    isPopular: boolean;
    requiresFFmpeg: boolean;
  }>;
  family: string;
  journeys: readonly ToolJourney[];
  support: Readonly<{
    disposition: ToolSupportDisposition;
    adapterId: string | null;
    reason: string | null;
    sourceNeeded: string | null;
    sourcePointers: ToolAcceptanceClaim['sourcePointers'];
  }>;
  implementation: Readonly<{
    provenance: 'mapped' | 'unknown';
    engines: readonly Readonly<{
      id: string;
      identity: string;
      implementationClass: string;
      processingLocation: string;
      executionProfile: ExecutionProfile;
      owner: string;
    }>[];
    reason: string | null;
    sourceNeeded: string | null;
  }>;
  controlledVerification: Readonly<{
    classification:
      | 'registered-with-semantic-policy'
      | 'explicit-fail-closed-contract'
      | 'not-verified';
    retainedExecutionResult: false;
    reason: string;
  }>;
  verificationEvidence: readonly ToolJourneyEvidenceView[];
  githubWork: ToolGithubWorkView;
  runtimeRequirement: Readonly<{
    classification:
      | 'declared-client-only'
      | 'declared-server-path-needs-environment-proof'
      | 'unknown';
    executionProfiles: readonly (ExecutionProfile | 'unknown')[];
    reason: string;
  }>;
  runtimeObservation: Readonly<{
    classification: 'not-loaded';
    reason: string;
  }>;
  attention: Readonly<{
    codes: readonly string[];
    summary: string;
  }>;
}>;

export type ToolFactoryReadModel = Readonly<{
  rows: readonly ToolFactoryRow[];
  counts: Readonly<Record<ToolSupportDisposition, number>>;
  memberships: ToolAcceptanceClaims['memberships'];
  getByToolId(toolId: string): ToolFactoryRow | null;
}>;

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function processorFamily(
  operation: string,
  renderer: string,
  inputFormat: string | null,
  outputFormat: string | null,
) {
  if (
    renderer === 'generic' &&
    operation === 'convert' &&
    inputFormat &&
    outputFormat
  ) {
    return `generic-convert:${resolveConversionDispatch(inputFormat, outputFormat).kind}`;
  }
  if (renderer === 'generic' && operation === 'compress' && inputFormat) {
    return `generic-compress:${resolveCompressionDispatch(inputFormat).target}`;
  }
  if (renderer === 'table') return `table-output:${outputFormat ?? 'unknown'}`;
  return `renderer:${renderer}`;
}

function runtimeRequirement(
  provenance: ReturnType<typeof getToolExecutionProvenance>,
) {
  if (provenance.kind === 'unknown') {
    return {
      classification: 'unknown' as const,
      executionProfiles: ['unknown'] as const,
      reason: provenance.reason,
    };
  }
  const needsEnvironmentProof = provenance.executionProfiles.some(
    (profile) => profile !== 'client-only',
  );
  return {
    classification: needsEnvironmentProof
      ? ('declared-server-path-needs-environment-proof' as const)
      : ('declared-client-only' as const),
    executionProfiles: [...provenance.executionProfiles],
    reason: needsEnvironmentProof
      ? 'The implementation includes repository server participation; this declaration does not prove compatibility in a deployed environment.'
      : 'The maintained implementation mapping declares browser execution; this is not a runtime result.',
  };
}

function attentionCodes({
  disposition,
  hasRegisteredProcessor,
  contractUnsupported,
  needsRuntimeProof,
}: {
  disposition: ToolSupportDisposition;
  hasRegisteredProcessor: boolean;
  contractUnsupported: boolean;
  needsRuntimeProof: boolean;
}) {
  if (disposition === 'supported') return [];
  if (disposition === 'unknown') return ['implementation-unknown'];
  const codes: string[] = [];
  if (!hasRegisteredProcessor) codes.push('no-registered-processor');
  if (contractUnsupported) codes.push('exact-contract-unsupported');
  if (needsRuntimeProof) codes.push('runtime-proof-needed');
  return codes;
}

function buildRow(
  tool: (typeof toolCatalog.activeTools)[number],
): Omit<ToolFactoryRow, 'verificationEvidence' | 'githubWork'> {
  const renderer = selectToolRenderer(tool);
  const acceptance = toolAcceptanceClaims.getByToolId(tool.id);
  if (!acceptance) {
    throw new TypeError(`Missing acceptance claim for ${tool.id}.`);
  }
  const provenance = getToolExecutionProvenance(tool.id);
  const disposition = acceptance.disposition;
  const runtime = runtimeRequirement(provenance);
  const contractUnsupported = disposition === 'unsupported';
  const codes = attentionCodes({
    disposition,
    hasRegisteredProcessor: acceptance.adapterId !== null,
    contractUnsupported,
    needsRuntimeProof:
      runtime.classification === 'declared-server-path-needs-environment-proof',
  });
  const engines =
    provenance.kind === 'mapped'
      ? provenance.engineIds.map((engineId) => {
          const engine = executionProvenance.getEngine(engineId);
          if (!engine)
            throw new TypeError(`Unknown execution engine: ${engineId}`);
          return {
            id: engine.id,
            identity: engine.implementation.identity,
            implementationClass: engine.implementation.class,
            processingLocation: engine.processingLocation,
            executionProfile: engine.executionProfile,
            owner: engine.owner,
          };
        })
      : [];
  const verification =
    disposition === 'supported'
      ? {
          classification: 'registered-with-semantic-policy' as const,
          retainedExecutionResult: false as const,
          reason:
            'A processor adapter is registered behind a semantic policy; this source view does not contain a retained execution result for this Tool.',
        }
      : disposition === 'unsupported'
        ? {
            classification: 'explicit-fail-closed-contract' as const,
            retainedExecutionResult: false as const,
            reason:
              'The maintained contract fails closed and supplies no positive operation result.',
          }
        : {
            classification: 'not-verified' as const,
            retainedExecutionResult: false as const,
            reason:
              'No registered processor verification exists for this Tool.',
          };

  return deepFreeze({
    toolId: tool.id,
    name: tool.name,
    description: tool.description,
    route: tool.canonicalRoute,
    catalogIntent: {
      operation: tool.operation,
      inputFormat: tool.from,
      outputFormat: tool.to,
      renderer,
      tags: [...tool.tags],
      priority: tool.priority,
      isBeta: tool.isBeta,
      isNew: tool.isNew,
      isPopular: tool.isPopular,
      requiresFFmpeg: tool.requiresFFmpeg,
    },
    family: processorFamily(tool.operation, renderer, tool.from, tool.to),
    journeys: toolJourneys.getByToolId(tool.id),
    support: {
      disposition,
      adapterId: acceptance.adapterId,
      reason: acceptance.reason,
      sourceNeeded: acceptance.sourceNeeded,
      sourcePointers: acceptance.sourcePointers,
    },
    implementation: {
      provenance: provenance.kind,
      engines,
      reason: provenance.kind === 'unknown' ? provenance.reason : null,
      sourceNeeded:
        provenance.kind === 'unknown' ? provenance.sourceNeeded : null,
    },
    controlledVerification: verification,
    runtimeRequirement: runtime,
    runtimeObservation: {
      classification: 'not-loaded' as const,
      reason:
        'No runtime observation source is loaded in this development-only view.',
    },
    attention: {
      codes,
      summary: codes.length
        ? codes.join(', ')
        : 'No source-owned blocker recorded.',
    },
  });
}

let cachedModel: ToolFactoryReadModel | undefined;

export function buildToolFactoryReadModel(): ToolFactoryReadModel {
  if (cachedModel) return cachedModel;
  const sourceRows = toolCatalog.activeTools.map(buildRow);
  const githubWorkIndex = buildToolGithubWorkIndex(
    retainedToolGithubWorkSnapshot,
    sourceRows.map((row) => ({ toolId: row.toolId, family: row.family })),
  );
  const rows = sourceRows.map((row) =>
    deepFreeze({
      ...row,
      verificationEvidence: retainedToolVerificationEvidence.getForTool(
        row.toolId,
      ),
      githubWork: githubWorkIndex.getForTool(row.toolId, row.family),
    }),
  );
  const byId = new Map(rows.map((row) => [row.toolId, row]));
  if (byId.size !== rows.length) {
    throw new TypeError('Tool Factory rows contain duplicate Tool ids.');
  }
  const counts = toolAcceptanceClaims.counts;
  cachedModel = deepFreeze({
    rows,
    counts,
    memberships: toolAcceptanceClaims.memberships,
    getByToolId(toolId: string) {
      return byId.get(toolId) ?? null;
    },
  });
  return cachedModel;
}

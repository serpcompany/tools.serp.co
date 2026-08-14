import { createHash } from 'node:crypto';

import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import { getGenericToolContract } from './generic-tool-contract.ts';
import { getTableOperationPolicy } from './table-operation-policy.ts';
import { getToolProcessorAvailability } from './tool-processor-registry.ts';
import { selectToolRenderer, type ToolRenderer } from './tool-renderer.ts';

export type ToolAcceptanceDisposition =
  | 'supported'
  | 'unsupported'
  | 'unwired'
  | 'unknown';

type AcceptanceAvailability = Readonly<
  | { kind: 'wired'; adapterId: string }
  | {
      kind: 'unwired' | 'unknown';
      reason: string;
      sourceNeeded: string;
    }
>;

type AcceptanceContractFact = Readonly<{
  state: 'supported' | 'unsupported' | 'not-applicable';
  reason: string | null;
}>;

type AcceptanceTableFact = Readonly<{
  kind: 'eligible' | 'unsupported' | 'unknown' | 'not-applicable';
  reason: string | null;
}>;

export type ToolAcceptanceSourceFact = Readonly<{
  toolId: string;
  renderer: ToolRenderer;
  availability: AcceptanceAvailability;
  genericContract: AcceptanceContractFact;
  tablePolicy: AcceptanceTableFact;
}>;

export type ToolAcceptanceClaim = Readonly<{
  toolId: string;
  disposition: ToolAcceptanceDisposition;
  adapterId: string | null;
  reason: string | null;
  sourceNeeded: string | null;
  sourcePointers: Readonly<{
    catalog: 'packages/app-core/src/lib/tool-catalog.ts';
    processor: 'apps/tools/lib/tool-processor-registry.ts';
    contract:
      | 'apps/tools/lib/generic-tool-contract.ts'
      | 'apps/tools/lib/table-operation-policy.ts'
      | 'apps/tools/lib/tool-processor-registry.ts';
  }>;
}>;

type ToolAcceptanceMembership = Readonly<{
  toolIds: readonly string[];
  sha256: string;
}>;

export type ToolAcceptanceClaims = Readonly<{
  all: readonly ToolAcceptanceClaim[];
  counts: Readonly<Record<ToolAcceptanceDisposition, number>>;
  memberships: Readonly<{
    all: ToolAcceptanceMembership;
    byDisposition: Readonly<
      Record<ToolAcceptanceDisposition, ToolAcceptanceMembership>
    >;
  }>;
  getByToolId(toolId: string): ToolAcceptanceClaim | null;
}>;

const DISPOSITIONS = Object.freeze([
  'supported',
  'unsupported',
  'unwired',
  'unknown',
] as const satisfies readonly ToolAcceptanceDisposition[]);
const ACCEPTANCE_RENDERERS = new Set<ToolRenderer>(
  toolCatalog.activeTools.map(selectToolRenderer),
);

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function membership(toolIds: readonly string[]): ToolAcceptanceMembership {
  const sorted = Object.freeze([...toolIds].sort());
  return Object.freeze({
    toolIds: sorted,
    sha256: `sha256:${createHash('sha256')
      .update(JSON.stringify(sorted))
      .digest('hex')}`,
  });
}

function contractKind(fact: ToolAcceptanceSourceFact) {
  if (fact.renderer === 'generic') return fact.genericContract.state;
  if (fact.renderer === 'table') return fact.tablePolicy.kind;
  return 'not-applicable';
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateSourceFact(fact: ToolAcceptanceSourceFact) {
  if (
    !fact ||
    !nonEmpty(fact.toolId) ||
    !ACCEPTANCE_RENDERERS.has(fact.renderer)
  ) {
    throw new TypeError('Tool acceptance source facts require an identity.');
  }
  if (!['wired', 'unwired', 'unknown'].includes(fact.availability?.kind)) {
    throw new TypeError(`${fact.toolId} has invalid processor availability.`);
  }
  if (
    fact.availability.kind === 'wired'
      ? !nonEmpty(fact.availability.adapterId)
      : !nonEmpty(fact.availability.reason) ||
        !nonEmpty(fact.availability.sourceNeeded)
  ) {
    throw new TypeError(
      `${fact.toolId} has incomplete processor availability.`,
    );
  }
  if (
    !['supported', 'unsupported', 'not-applicable'].includes(
      fact.genericContract?.state,
    ) ||
    !['eligible', 'unsupported', 'unknown', 'not-applicable'].includes(
      fact.tablePolicy?.kind,
    )
  ) {
    throw new TypeError(`${fact.toolId} has an invalid acceptance contract.`);
  }
  if (
    (fact.genericContract.state === 'unsupported' &&
      !nonEmpty(fact.genericContract.reason)) ||
    (fact.tablePolicy.kind !== 'eligible' &&
      fact.tablePolicy.kind !== 'not-applicable' &&
      !nonEmpty(fact.tablePolicy.reason))
  ) {
    throw new TypeError(
      `${fact.toolId} has an incomplete acceptance contract.`,
    );
  }
  const genericApplies = fact.renderer === 'generic';
  const tableApplies = fact.renderer === 'table';
  if (
    (genericApplies && fact.tablePolicy.kind !== 'not-applicable') ||
    (tableApplies && fact.genericContract.state !== 'not-applicable') ||
    (!genericApplies &&
      !tableApplies &&
      (fact.genericContract.state !== 'not-applicable' ||
        fact.tablePolicy.kind !== 'not-applicable'))
  ) {
    throw new TypeError(`${fact.toolId} has incoherent renderer contracts.`);
  }
}

function claimFor(fact: ToolAcceptanceSourceFact): ToolAcceptanceClaim {
  validateSourceFact(fact);
  const contract = contractKind(fact);
  const contractUnsupported = contract === 'unsupported';
  const contractEligible = contract === 'supported' || contract === 'eligible';
  const contractApplies =
    fact.renderer === 'generic' || fact.renderer === 'table';

  if (
    (fact.availability.kind === 'wired' &&
      contractApplies &&
      !contractEligible) ||
    (fact.availability.kind !== 'wired' && contractEligible)
  ) {
    throw new TypeError(
      `Contradictory processor acceptance facts for ${fact.toolId}.`,
    );
  }

  const disposition: ToolAcceptanceDisposition =
    fact.availability.kind === 'wired'
      ? 'supported'
      : contractUnsupported
        ? 'unsupported'
        : fact.availability.kind === 'unknown'
          ? 'unknown'
          : 'unwired';
  const contractPointer =
    fact.renderer === 'generic'
      ? ('apps/tools/lib/generic-tool-contract.ts' as const)
      : fact.renderer === 'table'
        ? ('apps/tools/lib/table-operation-policy.ts' as const)
        : ('apps/tools/lib/tool-processor-registry.ts' as const);
  const availabilityReason =
    fact.availability.kind === 'wired' ? null : fact.availability.reason;
  const reason =
    disposition === 'supported'
      ? null
      : disposition === 'unsupported'
        ? fact.renderer === 'generic'
          ? fact.genericContract.reason
          : fact.tablePolicy.reason
        : availabilityReason;

  if (disposition !== 'supported' && !reason) {
    throw new TypeError(`${fact.toolId} must name its acceptance reason.`);
  }

  return deepFreeze({
    toolId: fact.toolId,
    disposition,
    adapterId:
      fact.availability.kind === 'wired' ? fact.availability.adapterId : null,
    reason,
    sourceNeeded:
      fact.availability.kind === 'wired'
        ? null
        : fact.availability.sourceNeeded,
    sourcePointers: {
      catalog: 'packages/app-core/src/lib/tool-catalog.ts',
      processor: 'apps/tools/lib/tool-processor-registry.ts',
      contract: contractPointer,
    },
  });
}

export function createToolAcceptanceClaims(
  sourceFacts: readonly ToolAcceptanceSourceFact[],
): ToolAcceptanceClaims {
  const toolIds = sourceFacts.map((fact) => fact.toolId);
  if (new Set(toolIds).size !== toolIds.length) {
    throw new TypeError('Tool acceptance claims contain duplicate Tool ids.');
  }
  const all = Object.freeze(
    sourceFacts
      .map(claimFor)
      .sort((left, right) => left.toolId.localeCompare(right.toolId)),
  );
  const byId = new Map(all.map((claim) => [claim.toolId, claim]));
  const byDisposition = deepFreeze(
    Object.fromEntries(
      DISPOSITIONS.map((disposition) => [
        disposition,
        membership(
          all
            .filter((claim) => claim.disposition === disposition)
            .map((claim) => claim.toolId),
        ),
      ]),
    ) as Record<ToolAcceptanceDisposition, ToolAcceptanceMembership>,
  );
  const counts = deepFreeze(
    Object.fromEntries(
      DISPOSITIONS.map((disposition) => [
        disposition,
        byDisposition[disposition].toolIds.length,
      ]),
    ) as Record<ToolAcceptanceDisposition, number>,
  );

  return deepFreeze({
    all,
    counts,
    memberships: {
      all: membership(all.map((claim) => claim.toolId)),
      byDisposition,
    },
    getByToolId(toolId: string) {
      return byId.get(toolId) ?? null;
    },
  });
}

function canonicalSourceFact(
  tool: (typeof toolCatalog.activeTools)[number],
): ToolAcceptanceSourceFact {
  const availability = getToolProcessorAvailability(tool.id);
  const renderer = selectToolRenderer(tool);
  const genericContract = getGenericToolContract(tool.id);
  const tablePolicy = getTableOperationPolicy(tool.id);
  return {
    toolId: tool.id,
    renderer,
    availability:
      availability.kind === 'wired'
        ? { kind: availability.kind, adapterId: availability.adapterId }
        : {
            kind: availability.kind,
            reason: availability.reason,
            sourceNeeded: availability.sourceNeeded,
          },
    genericContract: {
      state: renderer === 'generic' ? genericContract.state : 'not-applicable',
      reason:
        renderer === 'generic' && genericContract.state === 'unsupported'
          ? genericContract.reason
          : null,
    },
    tablePolicy: {
      kind: renderer === 'table' ? tablePolicy.kind : 'not-applicable',
      reason:
        renderer === 'table' && tablePolicy.kind !== 'eligible'
          ? tablePolicy.reason
          : null,
    },
  };
}

export const toolAcceptanceClaims = createToolAcceptanceClaims(
  toolCatalog.activeTools.map(canonicalSourceFact),
);

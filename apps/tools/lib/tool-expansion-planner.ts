import type { ToolFactoryRow } from './tool-factory-read-model.ts';
import {
  getClientFirstDecision,
  type ClientFirstReviewCategory,
} from './tool-client-first-decisions.ts';

export type ToolExpansionCandidateEngine = Readonly<{
  id: string;
  identity: string;
  implementationClass: string;
  processingLocation: string;
  executionProfile: string;
  owner: string;
  source: 'maintained execution provenance';
  verifiedSupport: false;
}>;

export type ToolExpansionBlockerKind =
  | 'adapter'
  | 'browser-runtime-fit'
  | 'fixture'
  | 'semantic-validator'
  | 'limits'
  | 'licensing'
  | 'maintenance-review';

export type ToolExpansionBlocker = Readonly<{
  kind: ToolExpansionBlockerKind;
  status: 'missing' | 'needs-review';
  explanation: string;
}>;

export type ToolExpansionFact = Readonly<{
  statement: string;
  source: string;
}>;

export type ToolExpansionBrowserFeasibility =
  | 'existing-browser-code'
  | 'new-browser-wasm-library'
  | 'server-alternative-research'
  | 'catalog-review'
  | 'unresolved';

export type ToolExpansionGroup = Readonly<{
  id: string;
  rank: number;
  operationFamily: string;
  browserFeasibility: ToolExpansionBrowserFeasibility;
  testReadiness: 'fixture-and-verifiers' | 'unresolved';
  decisionCost: 'bounded' | 'multiple-open-decisions';
  operations: readonly string[];
  inputFormats: readonly string[];
  outputFormats: readonly string[];
  candidateEngines: readonly ToolExpansionCandidateEngine[];
  executionLocations: readonly string[];
  toolIds: readonly string[];
  unlockCount: number;
  supportMeaning: 'planning-candidates-only';
  facts: readonly ToolExpansionFact[];
  assumptions: readonly string[];
  blockers: readonly ToolExpansionBlocker[];
}>;

export type ToolExpansionPlan = Readonly<{
  unsupportedToolCount: number;
  groups: readonly ToolExpansionGroup[];
  ranking: Readonly<{
    method: string;
    assumptions: readonly string[];
  }>;
  supportNotice: string;
}>;

function values<Value>(items: readonly Value[]) {
  return Object.freeze(
    [...new Set(items)].sort((left, right) =>
      String(left).localeCompare(String(right)),
    ),
  );
}

function buildUnrankedGroup(
  operationFamily: string,
  rows: readonly ToolFactoryRow[],
  browserFeasibility: ToolExpansionBrowserFeasibility,
  testReadiness: 'fixture-and-verifiers' | 'unresolved',
  decisionCost: 'bounded' | 'multiple-open-decisions',
  decisionFacts: readonly ToolExpansionFact[],
  allowedCandidateIds?: ReadonlySet<string>,
) {
  const candidateById = new Map<string, ToolExpansionCandidateEngine>();
  for (const row of rows) {
    for (const engine of row.implementation.engines) {
      if (allowedCandidateIds && !allowedCandidateIds.has(engine.id)) continue;
      const candidate = {
        id: engine.id,
        identity: engine.identity,
        implementationClass: engine.implementationClass,
        processingLocation: engine.processingLocation,
        executionProfile: engine.executionProfile,
        owner: engine.owner,
        source: 'maintained execution provenance' as const,
        verifiedSupport: false as const,
      };
      const existing = candidateById.get(engine.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) {
        throw new TypeError(
          `Expansion candidate engine ${engine.id} has inconsistent source facts.`,
        );
      }
      candidateById.set(engine.id, Object.freeze(candidate));
    }
  }
  const toolIds = values(rows.map((row) => row.toolId));
  const candidateEngines = Object.freeze(
    [...candidateById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  );
  const inputFormats = values(
    rows.flatMap((row) =>
      row.catalogIntent.inputFormat ? [row.catalogIntent.inputFormat] : [],
    ),
  );
  const outputFormats = values(
    rows.flatMap((row) =>
      row.catalogIntent.outputFormat ? [row.catalogIntent.outputFormat] : [],
    ),
  );
  return {
    id: `family:${operationFamily}`,
    operationFamily,
    browserFeasibility,
    testReadiness,
    decisionCost,
    operations: values(rows.map((row) => row.catalogIntent.operation)),
    inputFormats,
    outputFormats,
    candidateEngines,
    executionLocations: values(
      [...candidateById.values()].map((engine) => engine.processingLocation),
    ),
    toolIds,
    unlockCount: toolIds.length,
    supportMeaning: 'planning-candidates-only' as const,
    facts: Object.freeze([
      Object.freeze({
        statement: `${toolIds.length.toLocaleString('en-US')} exact Tool IDs are explicitly unsupported.`,
        source: 'Tool Factory support read model',
      }),
      ...decisionFacts,
      Object.freeze({
        statement: `${inputFormats.length.toLocaleString('en-US')} catalog input formats and ${outputFormats.length.toLocaleString('en-US')} catalog output formats are represented.`,
        source: 'Tool Catalog intent',
      }),
      Object.freeze({
        statement: `${candidateEngines.length.toLocaleString('en-US')} maintained engine mappings are candidate inputs to review.`,
        source: 'Maintained execution provenance',
      }),
    ]),
    assumptions: Object.freeze([
      'Tools sharing this operation family and candidate mapping may fit one reviewed adapter.',
      'A candidate engine may not support every listed input/output pair; exact capability must be proven.',
    ]),
    blockers: Object.freeze([
      Object.freeze({
        kind: 'adapter' as const,
        status: 'missing' as const,
        explanation:
          'Every member is explicitly unsupported and has no registered exact processor adapter.',
      }),
      Object.freeze({
        kind: 'browser-runtime-fit' as const,
        status: 'needs-review' as const,
        explanation:
          'Mapped execution location is a source fact; compatibility and resource behavior still need controlled proof.',
      }),
      Object.freeze({
        kind: 'fixture' as const,
        status:
          testReadiness === 'fixture-and-verifiers'
            ? ('needs-review' as const)
            : ('needs-review' as const),
        explanation:
          testReadiness === 'fixture-and-verifiers'
            ? 'A distinct retained fixture exists; exact browser execution still must pass.'
            : 'This planner does not load a retained fixture inventory for every exact Tool ID.',
      }),
      Object.freeze({
        kind: 'semantic-validator' as const,
        status:
          testReadiness === 'fixture-and-verifiers'
            ? ('needs-review' as const)
            : ('missing' as const),
        explanation:
          testReadiness === 'fixture-and-verifiers'
            ? 'Independent format validators exist; the exact family policy still must pass review.'
            : 'The explicit unsupported contract has no exact semantic verifier policy.',
      }),
      Object.freeze({
        kind: 'limits' as const,
        status: 'needs-review' as const,
        explanation:
          'Input size, time, memory, and output limits need a reviewed family contract.',
      }),
      Object.freeze({
        kind: 'licensing' as const,
        status: 'needs-review' as const,
        explanation:
          'Candidate dependency and codec licenses need review for the intended distribution and runtime.',
      }),
      Object.freeze({
        kind: 'maintenance-review' as const,
        status: 'needs-review' as const,
        explanation:
          'Release health, browser support, security posture, and maintainer activity need review.',
      }),
    ]),
  };
}

export function buildToolExpansionPlan(
  rows: readonly ToolFactoryRow[],
): ToolExpansionPlan {
  const unsupportedRows = rows.filter(
    (row) => row.support.disposition === 'unsupported',
  );
  const unsupportedToolIds = new Set(unsupportedRows.map((row) => row.toolId));
  if (unsupportedToolIds.size !== unsupportedRows.length) {
    throw new TypeError(
      'Expansion planner input contains duplicate unsupported Tool IDs.',
    );
  }
  const rowsByFamily = new Map<
    string,
    {
      rows: ToolFactoryRow[];
      browserFeasibility: ToolExpansionBrowserFeasibility;
      testReadiness: 'fixture-and-verifiers' | 'unresolved';
      decisionCost: 'bounded' | 'multiple-open-decisions';
      facts: readonly ToolExpansionFact[];
      allowedCandidateIds?: ReadonlySet<string>;
    }
  >();
  const feasibilityByCategory: Record<
    ClientFirstReviewCategory,
    ToolExpansionBrowserFeasibility
  > = {
    'existing-browser-code-to-verify': 'existing-browser-code',
    'browser-library-research': 'new-browser-wasm-library',
    'server-alternative-research': 'server-alternative-research',
    'catalog-review': 'catalog-review',
    unresolved: 'unresolved',
  };
  for (const row of unsupportedRows) {
    const decision = getClientFirstDecision(row);
    const group = rowsByFamily.get(decision.groupId) ?? {
      rows: [],
      browserFeasibility: feasibilityByCategory[decision.reviewCategory],
      testReadiness: decision.testReadiness,
      decisionCost: decision.decisionCost,
      facts: decision.facts,
      allowedCandidateIds: decision.allowedCandidateIds,
    };
    group.rows.push(row);
    rowsByFamily.set(decision.groupId, group);
  }
  const unranked = [...rowsByFamily].map(([family, group]) =>
    buildUnrankedGroup(
      family,
      group.rows,
      group.browserFeasibility,
      group.testReadiness,
      group.decisionCost,
      group.facts,
      group.allowedCandidateIds,
    ),
  );
  const feasibilityRank: Record<ToolExpansionBrowserFeasibility, number> = {
    'existing-browser-code': 0,
    'new-browser-wasm-library': 1,
    'catalog-review': 2,
    'server-alternative-research': 3,
    unresolved: 4,
  };
  const readinessRank = { 'fixture-and-verifiers': 0, unresolved: 1 } as const;
  const decisionCostRank = {
    bounded: 0,
    'multiple-open-decisions': 1,
  } as const;
  unranked.sort(
    (left, right) =>
      feasibilityRank[left.browserFeasibility] -
        feasibilityRank[right.browserFeasibility] ||
      readinessRank[left.testReadiness] - readinessRank[right.testReadiness] ||
      decisionCostRank[left.decisionCost] -
        decisionCostRank[right.decisionCost] ||
      right.unlockCount - left.unlockCount ||
      left.operationFamily.localeCompare(right.operationFamily),
  );
  const groups = unranked.map((group, index) =>
    Object.freeze({ ...group, rank: index + 1 }),
  );
  const plannedToolIds = groups.flatMap((group) => group.toolIds);
  if (
    plannedToolIds.length !== unsupportedRows.length ||
    new Set(plannedToolIds).size !== unsupportedRows.length
  ) {
    throw new TypeError(
      'Expansion planner groups do not partition the unsupported Tool portfolio exactly once.',
    );
  }
  return Object.freeze({
    unsupportedToolCount: unsupportedRows.length,
    groups: Object.freeze(groups),
    ranking: Object.freeze({
      method:
        'Browser feasibility, test readiness, decision cost, exact Tool count, then stable family ID.',
      assumptions: Object.freeze([
        'Existing browser code with distinct fixtures and semantic validators is reviewed before speculative bulk mappings.',
        'Candidate categories and ranking do not establish feasibility or support.',
      ]),
    }),
    supportNotice:
      'Candidate library, engine mapping, or installed-package presence is planning evidence only and never verified support.',
  });
}

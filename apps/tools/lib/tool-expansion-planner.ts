import type { ToolFactoryRow } from './tool-factory-read-model.ts';

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

export type ToolExpansionGroup = Readonly<{
  id: string;
  rank: number;
  operationFamily: string;
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
) {
  const candidateById = new Map<string, ToolExpansionCandidateEngine>();
  for (const row of rows) {
    for (const engine of row.implementation.engines) {
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
        status: 'needs-review' as const,
        explanation:
          'This planner does not load a retained fixture inventory for every exact Tool ID.',
      }),
      Object.freeze({
        kind: 'semantic-validator' as const,
        status: 'missing' as const,
        explanation:
          'The explicit unsupported contract has no exact semantic verifier policy.',
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
  const rowsByFamily = new Map<string, ToolFactoryRow[]>();
  for (const row of unsupportedRows) {
    const members = rowsByFamily.get(row.family) ?? [];
    members.push(row);
    rowsByFamily.set(row.family, members);
  }
  const unranked = [...rowsByFamily].map(([family, members]) =>
    buildUnrankedGroup(family, members),
  );
  unranked.sort(
    (left, right) =>
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
        'Exact unsupported Tool count descending, then operation family name.',
      assumptions: Object.freeze([
        'A reviewed family adapter may reduce repeated work across its exact member Tools.',
        'Larger exact groups are evaluated first; this ordering does not establish feasibility or support.',
      ]),
    }),
    supportNotice:
      'Candidate library, engine mapping, or installed-package presence is planning evidence only and never verified support.',
  });
}

import type { ToolFactoryRow } from './tool-factory-read-model.ts';
import {
  getClientFirstDecision,
  type ClientFirstReviewCategory,
} from './tool-client-first-decisions.ts';

export type ToolCurrentExecutionState =
  | 'browser'
  | 'hybrid'
  | 'server'
  | 'unsupported'
  | 'unknown';

export type ToolPreferredTarget =
  | 'browser-first'
  | 'server-required'
  | 'undecided';

export type ToolServerDependency =
  | 'none'
  | 'optional-fallback'
  | 'required'
  | 'unknown';

export type ToolBrowserFeasibility =
  | 'existing-browser-path'
  | 'new-browser-library'
  | 'server-required'
  | 'catalog-review'
  | 'unresolved';

export type ToolClientFirstCandidateEngine = Readonly<{
  id: string;
  identity: string;
  processingLocation: string;
  executionProfile: string;
  source: 'maintained execution provenance';
  verifiedSupport: false;
}>;

export type ToolClientFirstRow = Readonly<{
  toolId: string;
  currentExecution: Readonly<{
    state: ToolCurrentExecutionState;
    engineIds: readonly string[];
    explanation: string;
  }>;
  preferredTarget: ToolPreferredTarget;
  serverDependency: ToolServerDependency;
  browserFeasibility: ToolBrowserFeasibility;
  candidateEngines: readonly ToolClientFirstCandidateEngine[];
}>;

export type ToolClientFirstPlan = Readonly<{
  rows: readonly ToolClientFirstRow[];
  getByToolId(toolId: string): ToolClientFirstRow | null;
}>;

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function supportedExecution(row: ToolFactoryRow): ToolClientFirstRow {
  const profiles = new Set(
    row.implementation.engines.map((engine) => engine.executionProfile),
  );
  const hasBrowser = profiles.has('client-only');
  const hasAssistance = profiles.has('server-assisted');
  const hasServer = profiles.has('server-executed');
  const state: ToolCurrentExecutionState = hasServer
    ? 'server'
    : hasBrowser && hasAssistance
      ? 'hybrid'
      : hasBrowser
        ? 'browser'
        : hasAssistance
          ? 'hybrid'
          : 'unknown';
  const explanation =
    state === 'browser'
      ? 'The registered processor executes in the browser.'
      : state === 'hybrid'
        ? 'The registered processor uses browser execution with server assistance for some inputs.'
        : state === 'server'
          ? 'The registered processor executes on the server today.'
          : 'The registered processor has no classified execution location.';
  return {
    toolId: row.toolId,
    currentExecution: {
      state,
      engineIds: row.implementation.engines.map((engine) => engine.id),
      explanation,
    },
    preferredTarget: hasBrowser ? 'browser-first' : 'undecided',
    serverDependency: hasServer
      ? 'required'
      : hasAssistance
        ? 'optional-fallback'
        : hasBrowser
          ? 'none'
          : 'unknown',
    browserFeasibility: hasBrowser ? 'existing-browser-path' : 'unresolved',
    candidateEngines: [],
  };
}

function unsupportedExecution(row: ToolFactoryRow): ToolClientFirstRow {
  const decision = getClientFirstDecision(row);
  const feasibilityByCategory: Record<
    ClientFirstReviewCategory,
    ToolBrowserFeasibility
  > = {
    'existing-browser-code-to-verify': 'existing-browser-path',
    'browser-library-research': 'new-browser-library',
    'server-alternative-research': 'unresolved',
    'catalog-review': 'catalog-review',
    unresolved: 'unresolved',
  };
  const browserFeasibility = feasibilityByCategory[decision.reviewCategory];
  const boundedBrowserWave =
    decision.reviewCategory === 'existing-browser-code-to-verify';
  return {
    toolId: row.toolId,
    currentExecution: {
      state: 'unsupported',
      engineIds: [],
      explanation:
        'This Tool fails closed today; no processor engine is registered for this exact operation.',
    },
    preferredTarget: boundedBrowserWave ? 'browser-first' : 'undecided',
    serverDependency: 'unknown',
    browserFeasibility,
    candidateEngines: row.implementation.engines.map((engine) => ({
      id: engine.id,
      identity: engine.identity,
      processingLocation: engine.processingLocation,
      executionProfile: engine.executionProfile,
      source: 'maintained execution provenance',
      verifiedSupport: false,
    })),
  };
}

function unknownExecution(row: ToolFactoryRow): ToolClientFirstRow {
  return {
    toolId: row.toolId,
    currentExecution: {
      state: 'unknown',
      engineIds: [],
      explanation: 'The current processor execution is not known.',
    },
    preferredTarget: 'undecided',
    serverDependency: 'unknown',
    browserFeasibility: 'unresolved',
    candidateEngines: [],
  };
}

export function buildToolClientFirstPlan(
  rows: readonly ToolFactoryRow[],
): ToolClientFirstPlan {
  const projected = rows.map((row) =>
    deepFreeze(
      row.support.disposition === 'supported'
        ? supportedExecution(row)
        : row.support.disposition === 'unsupported'
          ? unsupportedExecution(row)
          : unknownExecution(row),
    ),
  );
  const byId = new Map(projected.map((row) => [row.toolId, row]));
  if (byId.size !== projected.length) {
    throw new TypeError('Client-first plan contains duplicate Tool IDs.');
  }
  return deepFreeze({
    rows: projected,
    getByToolId(toolId: string) {
      return byId.get(toolId) ?? null;
    },
  });
}

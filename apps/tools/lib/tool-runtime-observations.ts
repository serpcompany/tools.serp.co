type D1Value = string | number | null;

export type ToolRuntimeObservationStatement = Readonly<{
  bind(...values: D1Value[]): ToolRuntimeObservationStatement;
  all(): Promise<Readonly<{ results?: unknown[] }>>;
}>;

export type ToolRuntimeObservationDatabase = Readonly<{
  prepare(query: string): ToolRuntimeObservationStatement;
}>;

export type ToolRuntimePath =
  | 'upload'
  | 'direct-url'
  | 'youtube-extractor'
  | 'other'
  | 'unclassified-url';

export type ToolRuntimeFailureClassifier =
  | 'processing-failed'
  | 'cancelled'
  | 'unclassified-failure';

export type ToolRuntimeObservationRecord = Readonly<{
  toolId: string;
  path: ToolRuntimePath;
  result: 'succeeded' | 'failed';
  observedAt: string;
  errorClassifier: ToolRuntimeFailureClassifier | null;
}>;

type ObservationWindow = Readonly<{
  environment: 'DEV/STAGING';
  windowStartedAt: string;
  windowEndedAt: string;
}>;

export type ToolRuntimePathObservation =
  | Readonly<
      ObservationWindow & {
        path: ToolRuntimePath;
        label: string;
        state: 'observed';
        sampleSize: number;
        lastObservedAt: string;
        lastResult: 'succeeded' | 'failed';
        lastErrorClassifier: ToolRuntimeFailureClassifier | null;
        freshness: 'fresh' | 'stale';
        ageMinutes: number;
      }
    >
  | Readonly<
      ObservationWindow & {
        path: ToolRuntimePath;
        label: string;
        state: 'no-observations';
        sampleSize: 0;
        reason: string;
      }
    >;

export type ToolRuntimeObservationView = Readonly<{
  toolId: string;
  paths: readonly ToolRuntimePathObservation[];
}>;

type LoadedPortfolio = Readonly<{
  environment: 'DEV/STAGING';
  state: 'loaded';
  source: Readonly<{
    authority: 'DEV/STAGING D1 tool_runs';
    windowStartedAt: string;
    windowEndedAt: string;
    rowLimit: number;
    rowsRead: number;
    freshnessThresholdMinutes: number;
  }>;
  tools: readonly ToolRuntimeObservationView[];
}>;

type UnavailablePortfolio = Readonly<{
  environment: 'DEV/STAGING' | 'LOCAL';
  state: 'unavailable';
  reason: string;
  tools: readonly never[];
}>;

export type ToolRuntimeObservationPortfolio =
  | LoadedPortfolio
  | UnavailablePortfolio;

const WINDOW_HOURS = 24;
const ROW_LIMIT = 500;
const FRESHNESS_THRESHOLD_MINUTES = 60;
const DEV_STAGING_ORIGIN =
  'https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev';

const pathLabels: Readonly<Record<ToolRuntimePath, string>> = Object.freeze({
  upload: 'Upload',
  'direct-url': 'Direct media link',
  'youtube-extractor': 'YouTube or extractor',
  other: 'Other',
  'unclassified-url': 'Older unclassified link',
});

const runtimePaths = Object.freeze([
  'upload',
  'direct-url',
  'youtube-extractor',
  'other',
  'unclassified-url',
] as const);

const repositoryOwnedFailureClassifiers: Readonly<
  Record<string, ToolRuntimeFailureClassifier>
> = Object.freeze({
  failed: 'processing-failed',
  workflow_failed: 'processing-failed',
  cancelled: 'cancelled',
  workflow_cancelled: 'cancelled',
});

function classifyFailure(value: unknown): ToolRuntimeFailureClassifier | null {
  if (typeof value !== 'string' || !value) return null;
  return repositoryOwnedFailureClassifiers[value] ?? 'unclassified-failure';
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function parseMetadata(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function classifyPath(metadata: Record<string, unknown> | null) {
  const declared = metadata?.runtimePath;
  if (
    typeof declared === 'string' &&
    runtimePaths.includes(declared as ToolRuntimePath)
  ) {
    return declared as ToolRuntimePath;
  }
  if (metadata?.source === 'file') return 'upload';
  if (metadata?.source === 'url') return 'unclassified-url';
  return 'other';
}

function normalizeRecord(
  value: unknown,
  knownToolIds: ReadonlySet<string>,
  windowStartedAt: string,
  windowEndedAt: string,
): ToolRuntimeObservationRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.toolId !== 'string' ||
    !knownToolIds.has(row.toolId) ||
    (row.status !== 'succeeded' && row.status !== 'failed') ||
    typeof row.startedAt !== 'string'
  ) {
    return null;
  }
  const observedAt = new Date(row.startedAt);
  if (
    Number.isNaN(observedAt.valueOf()) ||
    observedAt.valueOf() < new Date(windowStartedAt).valueOf() ||
    observedAt.valueOf() > new Date(windowEndedAt).valueOf()
  ) {
    return null;
  }
  return deepFreeze({
    toolId: row.toolId,
    path: classifyPath(parseMetadata(row.metadata)),
    result: row.status,
    observedAt: observedAt.toISOString(),
    errorClassifier: classifyFailure(row.errorCode),
  });
}

export function buildToolRuntimeObservationView(
  records: readonly ToolRuntimeObservationRecord[],
  request: Readonly<{
    toolId: string;
    windowStartedAt: string;
    windowEndedAt: string;
    now: Date;
  }>,
): ToolRuntimeObservationView {
  const paths = runtimePaths.map((path): ToolRuntimePathObservation => {
    const matching = records
      .filter(
        (record) => record.toolId === request.toolId && record.path === path,
      )
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt));
    const common = {
      path,
      label: pathLabels[path],
      environment: 'DEV/STAGING' as const,
      windowStartedAt: request.windowStartedAt,
      windowEndedAt: request.windowEndedAt,
    };
    const latest = matching[0];
    if (!latest) {
      return deepFreeze({
        ...common,
        state: 'no-observations' as const,
        sampleSize: 0 as const,
        reason: `No classified ${pathLabels[path]} runs were present in the bounded DEV/STAGING window.`,
      });
    }
    const ageMinutes = Math.max(
      0,
      Math.floor(
        (request.now.valueOf() - new Date(latest.observedAt).valueOf()) /
          60_000,
      ),
    );
    return deepFreeze({
      ...common,
      state: 'observed' as const,
      sampleSize: matching.length,
      lastObservedAt: latest.observedAt,
      lastResult: latest.result,
      lastErrorClassifier: latest.errorClassifier,
      freshness:
        ageMinutes <= FRESHNESS_THRESHOLD_MINUTES
          ? ('fresh' as const)
          : ('stale' as const),
      ageMinutes,
    });
  });
  return deepFreeze({ toolId: request.toolId, paths });
}

export async function loadToolRuntimeObservations(
  database: ToolRuntimeObservationDatabase | null,
  request: Readonly<{
    environment: 'DEV/STAGING' | 'LOCAL';
    sourceOrigin: string;
    toolIds: readonly string[];
    now: Date;
  }>,
): Promise<ToolRuntimeObservationPortfolio> {
  if (request.environment !== 'DEV/STAGING') {
    return deepFreeze({
      environment: request.environment,
      state: 'unavailable',
      reason:
        'Runtime observations are queried only from the private DEV/STAGING D1 binding.',
      tools: [],
    });
  }
  if (request.sourceOrigin !== DEV_STAGING_ORIGIN) {
    return deepFreeze({
      environment: request.environment,
      state: 'unavailable',
      reason:
        'Runtime observations require the isolated DEV/STAGING Worker origin; no database was queried.',
      tools: [],
    });
  }
  if (!database) {
    return deepFreeze({
      environment: request.environment,
      state: 'unavailable',
      reason: 'The private DEV/STAGING D1 binding is unavailable.',
      tools: [],
    });
  }
  if (
    Number.isNaN(request.now.valueOf()) ||
    !request.toolIds.length ||
    new Set(request.toolIds).size !== request.toolIds.length
  ) {
    throw new TypeError(
      'Runtime observation request requires unique Tool IDs and a valid clock.',
    );
  }

  const windowEndedAt = request.now.toISOString();
  const windowStartedAt = new Date(
    request.now.valueOf() - WINDOW_HOURS * 60 * 60 * 1_000,
  ).toISOString();
  try {
    const statement = database.prepare(`
      SELECT
        tool_id AS toolId,
        status,
        started_at AS startedAt,
        error_code AS errorCode,
        metadata
      FROM tool_runs
      WHERE status IN ('succeeded', 'failed') AND started_at >= ?
      ORDER BY started_at DESC
      LIMIT ?
    `);
    const result = await statement.bind(windowStartedAt, ROW_LIMIT).all();
    const rawRows = (result.results ?? []).slice(0, ROW_LIMIT);
    const knownToolIds = new Set(request.toolIds);
    const records = rawRows.flatMap((row): ToolRuntimeObservationRecord[] => {
      const normalized = normalizeRecord(
        row,
        knownToolIds,
        windowStartedAt,
        windowEndedAt,
      );
      return normalized ? [normalized] : [];
    });
    const observedToolIds = new Set(records.map((record) => record.toolId));
    const tools = request.toolIds
      .filter((toolId) => observedToolIds.has(toolId))
      .map((toolId) =>
        buildToolRuntimeObservationView(records, {
          toolId,
          windowStartedAt,
          windowEndedAt,
          now: request.now,
        }),
      );
    return deepFreeze({
      environment: request.environment,
      state: 'loaded',
      source: {
        authority: 'DEV/STAGING D1 tool_runs',
        windowStartedAt,
        windowEndedAt,
        rowLimit: ROW_LIMIT,
        rowsRead: rawRows.length,
        freshnessThresholdMinutes: FRESHNESS_THRESHOLD_MINUTES,
      },
      tools,
    });
  } catch {
    return deepFreeze({
      environment: request.environment,
      state: 'unavailable',
      reason:
        'The private DEV/STAGING runtime source could not be read. Verify its binding and migrations.',
      tools: [],
    });
  }
}

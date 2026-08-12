export const TOOL_FACTORY_COLUMN_IDS = Object.freeze([
  'tool',
  'support',
  'operationDisplay',
  'family',
  'engines',
  'profiles',
  'verification',
  'exactTest',
  'runtimeRequirement',
  'observation',
  'attention',
  'toolId',
  'description',
  'route',
  'operation',
  'inputFormat',
  'outputFormat',
  'renderer',
  'tags',
  'catalogPriority',
  'catalogFlags',
  'adapter',
  'supportReason',
  'engineIds',
  'processingLocations',
  'implementationOwners',
  'verificationReason',
  'runtimeReason',
  'observationReason',
  'attentionSummary',
] as const);

export type ToolFactoryColumnId = (typeof TOOL_FACTORY_COLUMN_IDS)[number];

const DEFAULT_VISIBLE_COLUMNS: readonly ToolFactoryColumnId[] = Object.freeze([
  'tool',
  'support',
  'operationDisplay',
  'family',
  'engines',
  'profiles',
  'verification',
  'exactTest',
  'runtimeRequirement',
  'observation',
  'attention',
]);

export type ToolFactoryViewState = Readonly<{
  expansionGroup: string;
  search: string;
  filters: Readonly<{
    support: string;
    family: string;
    profile: string;
    verification: string;
  }>;
  sorting: readonly Readonly<{ id: ToolFactoryColumnId; desc: boolean }>[];
  visibleColumns: readonly ToolFactoryColumnId[];
  pageIndex: number;
  pageSize: 25 | 50 | 100;
}>;

export const DEFAULT_TOOL_FACTORY_VIEW: ToolFactoryViewState = Object.freeze({
  expansionGroup: '',
  search: '',
  filters: Object.freeze({
    support: '',
    family: '',
    profile: '',
    verification: '',
  }),
  sorting: Object.freeze([]),
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  pageIndex: 0,
  pageSize: 50,
});

export function clampToolFactoryPageIndex(
  pageIndex: number,
  filteredRows: number,
  pageSize: number,
) {
  const lastPageIndex = Math.max(0, Math.ceil(filteredRows / pageSize) - 1);
  return Math.min(Math.max(0, pageIndex), lastPageIndex);
}

const supportValues = new Set([
  'supported',
  'unsupported',
  'unwired',
  'unknown',
]);
const verificationValues = new Set([
  'registered-with-semantic-policy',
  'explicit-fail-closed-contract',
  'not-verified',
]);
const columnIds = new Set<string>(TOOL_FACTORY_COLUMN_IDS);

function boundedText(value: string | null, maximum: number) {
  const normalized = value?.trim() ?? '';
  return normalized.length <= maximum ? normalized : '';
}

function allowed(value: string | null, values: ReadonlySet<string>) {
  const normalized = boundedText(value, 200);
  return values.has(normalized) ? normalized : '';
}

function visibleColumns(value: string | null) {
  if (!value) return DEFAULT_VISIBLE_COLUMNS;
  const result = [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry): entry is ToolFactoryColumnId => columnIds.has(entry)),
    ),
  ];
  return result.length ? Object.freeze(result) : DEFAULT_VISIBLE_COLUMNS;
}

function sorting(value: string | null) {
  if (!value) return DEFAULT_TOOL_FACTORY_VIEW.sorting;
  const [id, direction, extra] = value.split(':');
  if (
    extra ||
    !id ||
    !columnIds.has(id) ||
    (direction !== 'asc' && direction !== 'desc')
  ) {
    return DEFAULT_TOOL_FACTORY_VIEW.sorting;
  }
  return Object.freeze([
    Object.freeze({
      id: id as ToolFactoryColumnId,
      desc: direction === 'desc',
    }),
  ]);
}

export function parseToolFactoryView(
  search: string,
  options: Readonly<{
    families: readonly string[];
    profiles: readonly string[];
    expansionGroups: readonly string[];
  }>,
): ToolFactoryViewState {
  const parameters = new URLSearchParams(search);
  const page = Number(parameters.get('page'));
  const rows = Number(parameters.get('rows'));
  return Object.freeze({
    expansionGroup: allowed(
      parameters.get('expansion'),
      new Set(options.expansionGroups),
    ),
    search: boundedText(parameters.get('q'), 200),
    filters: Object.freeze({
      support: allowed(parameters.get('support'), supportValues),
      family: allowed(parameters.get('family'), new Set(options.families)),
      profile: allowed(parameters.get('profile'), new Set(options.profiles)),
      verification: allowed(parameters.get('verification'), verificationValues),
    }),
    sorting: sorting(parameters.get('sort')),
    visibleColumns: visibleColumns(parameters.get('columns')),
    pageIndex: Number.isSafeInteger(page) && page > 0 ? page - 1 : 0,
    pageSize: new Set([25, 50, 100]).has(rows) ? (rows as 25 | 50 | 100) : 50,
  });
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function serializeToolFactoryView(view: ToolFactoryViewState) {
  const parameters = new URLSearchParams();
  if (view.expansionGroup) {
    parameters.set('expansion', view.expansionGroup);
  }
  if (view.search) parameters.set('q', view.search);
  if (view.filters.support) parameters.set('support', view.filters.support);
  if (view.filters.family) parameters.set('family', view.filters.family);
  if (view.filters.profile) parameters.set('profile', view.filters.profile);
  if (view.filters.verification) {
    parameters.set('verification', view.filters.verification);
  }
  const sort = view.sorting[0];
  if (sort) parameters.set('sort', `${sort.id}:${sort.desc ? 'desc' : 'asc'}`);
  if (!sameValues(view.visibleColumns, DEFAULT_VISIBLE_COLUMNS)) {
    parameters.set('columns', view.visibleColumns.join(','));
  }
  if (view.pageIndex > 0) parameters.set('page', String(view.pageIndex + 1));
  if (view.pageSize !== 50) parameters.set('rows', String(view.pageSize));
  const query = parameters.toString();
  return query ? `?${query}` : '';
}

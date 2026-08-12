'use client';

import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type Updater,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@serp-tools/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@serp-tools/ui/components/dialog';
import { Input } from '@serp-tools/ui/components/input';

import type {
  ToolFactoryReadModel,
  ToolFactoryRow,
  ToolSupportDisposition,
} from '../../../lib/tool-factory-read-model.ts';
import type { ToolFactoryDeployment } from '../../../lib/tool-factory-access.ts';
import {
  DEFAULT_TOOL_FACTORY_VIEW,
  clampToolFactoryPageIndex,
  parseToolFactoryView,
  serializeToolFactoryView,
  TOOL_FACTORY_COLUMN_IDS,
  type ToolFactoryColumnId,
  type ToolFactoryViewState,
} from '../../../lib/tool-factory-view-state.ts';

type ToolFactoryTableModel = Pick<ToolFactoryReadModel, 'rows' | 'counts'>;

function joined(values: readonly string[]) {
  return values.length ? values.join(', ') : '—';
}

function operationLabel(row: ToolFactoryRow) {
  if (row.catalogIntent.inputFormat || row.catalogIntent.outputFormat) {
    return `${row.catalogIntent.inputFormat ?? '—'} → ${row.catalogIntent.outputFormat ?? '—'}`;
  }
  return row.catalogIntent.operation.replaceAll('-', ' ');
}

function engineNames(row: ToolFactoryRow) {
  return joined(row.implementation.engines.map((engine) => engine.identity));
}

function profiles(row: ToolFactoryRow) {
  return joined(row.runtimeRequirement.executionProfiles);
}

const verifiedDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

function formatVerifiedDate(verifiedAt: string) {
  return verifiedDateFormatter.format(new Date(verifiedAt));
}

function exactTestLabel(row: ToolFactoryRow) {
  const evidence = row.verificationEvidence.exact;
  if (!evidence) return 'Not tested here';
  return `${evidence.result === 'passed' ? 'Passed' : 'Failed'} · ${formatVerifiedDate(evidence.verifiedAt)}`;
}

function SupportBadge({
  disposition,
}: {
  disposition: ToolSupportDisposition;
}) {
  const tone =
    disposition === 'supported'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : disposition === 'unsupported'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : disposition === 'unknown'
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-blue-200 bg-blue-50 text-blue-800';
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${tone}`}
    >
      {disposition}
    </span>
  );
}

function SortButton({
  column,
  label,
}: {
  column: Column<ToolFactoryRow>;
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-slate-700 hover:text-slate-950"
      onClick={column.getToggleSortingHandler()}
    >
      {label}
      {sorted === 'asc' ? (
        <ArrowUp className="size-3.5" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="size-3.5" />
      ) : (
        <ArrowUpDown className="size-3.5 text-slate-400" />
      )}
    </button>
  );
}

const columns: ColumnDef<ToolFactoryRow>[] = [
  {
    id: 'tool',
    accessorFn: (row) => `${row.name} ${row.toolId}`,
    header: ({ column }) => <SortButton column={column} label="Tool" />,
    cell: ({ row }) => (
      <div className="min-w-52">
        <div className="font-medium text-slate-950">{row.original.name}</div>
        <div className="font-mono text-xs text-slate-500">
          {row.original.toolId}
        </div>
      </div>
    ),
    size: 270,
  },
  {
    id: 'support',
    accessorFn: (row) => row.support.disposition,
    header: ({ column }) => <SortButton column={column} label="Support" />,
    cell: ({ row }) => (
      <SupportBadge disposition={row.original.support.disposition} />
    ),
    size: 140,
  },
  {
    id: 'operationDisplay',
    accessorFn: operationLabel,
    header: ({ column }) => <SortButton column={column} label="Operation" />,
    size: 150,
  },
  {
    accessorKey: 'family',
    header: ({ column }) => <SortButton column={column} label="Family" />,
    size: 220,
  },
  {
    id: 'engines',
    accessorFn: engineNames,
    header: ({ column }) => (
      <SortButton column={column} label="Library / engine" />
    ),
    size: 300,
  },
  {
    id: 'profiles',
    accessorFn: profiles,
    header: ({ column }) => (
      <SortButton column={column} label="Execution profile" />
    ),
    size: 220,
  },
  {
    id: 'verification',
    accessorFn: (row) => row.controlledVerification.classification,
    header: ({ column }) => (
      <SortButton column={column} label="Family policy" />
    ),
    size: 220,
  },
  {
    id: 'exactTest',
    accessorFn: exactTestLabel,
    header: ({ column }) => (
      <SortButton column={column} label="Latest exact test" />
    ),
    size: 190,
  },
  {
    id: 'runtimeRequirement',
    accessorFn: (row) => row.runtimeRequirement.classification,
    header: ({ column }) => (
      <SortButton column={column} label="Runtime requirement" />
    ),
    size: 260,
  },
  {
    id: 'observation',
    accessorFn: (row) => row.runtimeObservation.classification,
    header: ({ column }) => (
      <SortButton column={column} label="Runtime observation" />
    ),
    size: 190,
  },
  {
    id: 'attention',
    accessorFn: (row) => joined(row.attention.codes),
    header: ({ column }) => <SortButton column={column} label="Attention" />,
    size: 260,
  },
  { accessorKey: 'toolId', header: 'Tool ID', size: 220 },
  { accessorKey: 'description', header: 'Description', size: 380 },
  { accessorKey: 'route', header: 'Route', size: 230 },
  {
    id: 'operation',
    accessorFn: (row) => row.catalogIntent.operation,
    header: 'Operation type',
    size: 160,
  },
  {
    id: 'inputFormat',
    accessorFn: (row) => row.catalogIntent.inputFormat ?? '—',
    header: 'Input format',
    size: 130,
  },
  {
    id: 'outputFormat',
    accessorFn: (row) => row.catalogIntent.outputFormat ?? '—',
    header: 'Output format',
    size: 130,
  },
  {
    id: 'renderer',
    accessorFn: (row) => row.catalogIntent.renderer,
    header: 'Renderer',
    size: 170,
  },
  {
    id: 'tags',
    accessorFn: (row) => joined(row.catalogIntent.tags),
    header: 'Tags',
    size: 250,
  },
  {
    id: 'catalogPriority',
    accessorFn: (row) => row.catalogIntent.priority ?? '—',
    header: 'Catalog priority',
    size: 140,
  },
  {
    id: 'catalogFlags',
    accessorFn: (row) =>
      joined(
        [
          row.catalogIntent.isBeta && 'beta',
          row.catalogIntent.isNew && 'new',
          row.catalogIntent.isPopular && 'popular',
          row.catalogIntent.requiresFFmpeg && 'requires FFmpeg',
        ].filter((flag): flag is string => Boolean(flag)),
      ),
    header: 'Catalog flags',
    size: 190,
  },
  {
    id: 'adapter',
    accessorFn: (row) => row.support.adapterId ?? '—',
    header: 'Adapter',
    size: 220,
  },
  {
    id: 'supportReason',
    accessorFn: (row) => row.support.reason ?? '—',
    header: 'Support reason',
    size: 420,
  },
  {
    id: 'engineIds',
    accessorFn: (row) =>
      joined(row.implementation.engines.map((engine) => engine.id)),
    header: 'Engine IDs',
    size: 280,
  },
  {
    id: 'processingLocations',
    accessorFn: (row) =>
      joined(
        row.implementation.engines.map((engine) => engine.processingLocation),
      ),
    header: 'Processing locations',
    size: 240,
  },
  {
    id: 'implementationOwners',
    accessorFn: (row) =>
      joined(row.implementation.engines.map((engine) => engine.owner)),
    header: 'Implementation owners',
    size: 360,
  },
  {
    id: 'verificationReason',
    accessorFn: (row) => row.controlledVerification.reason,
    header: 'Verification reason',
    size: 420,
  },
  {
    id: 'runtimeReason',
    accessorFn: (row) => row.runtimeRequirement.reason,
    header: 'Runtime reason',
    size: 420,
  },
  {
    id: 'observationReason',
    accessorFn: (row) => row.runtimeObservation.reason,
    header: 'Observation reason',
    size: 400,
  },
  {
    id: 'attentionSummary',
    accessorFn: (row) => row.attention.summary,
    header: 'Attention summary',
    size: 380,
  },
];

function unique(
  rows: readonly ToolFactoryRow[],
  value: (row: ToolFactoryRow) => string,
) {
  return [...new Set(rows.map(value).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function familyPolicyExplanation(row: ToolFactoryRow) {
  if (
    row.controlledVerification.classification ===
    'registered-with-semantic-policy'
  ) {
    return 'This Tool belongs to a family with a registered processor and semantic checks. That does not prove this exact Tool was run.';
  }
  if (
    row.controlledVerification.classification ===
    'explicit-fail-closed-contract'
  ) {
    return 'This family is configured to refuse this operation rather than return an unverified result.';
  }
  return 'No registered family verification policy exists for this Tool.';
}

type DisplayEvidence =
  | NonNullable<ToolFactoryRow['verificationEvidence']['exact']>
  | ToolFactoryRow['verificationEvidence']['family'][number];

function EvidenceResult({
  evidence,
  family,
}: {
  evidence: DisplayEvidence;
  family: boolean;
}) {
  const resultLabel = `${evidence.result === 'passed' ? 'Passed' : 'Failed'}${family ? ' family run' : ''}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            evidence.result === 'passed'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {resultLabel}
        </span>
        <span className="text-sm text-slate-700">{evidence.environment}</span>
        <time className="text-sm text-slate-500" dateTime={evidence.verifiedAt}>
          {formatVerifiedDate(evidence.verifiedAt)}
        </time>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
        {evidence.checkedBehaviors.map((behavior) => (
          <li key={behavior}>{behavior}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a
          className="font-medium text-blue-700 underline underline-offset-4 hover:text-blue-900"
          href={evidence.screenshotUrl}
          rel="noreferrer"
          target="_blank"
        >
          {family ? 'View family screenshot' : 'View screenshot'}
        </a>
        <span className="font-mono text-xs text-slate-500">
          {evidence.artifact.runId}
        </span>
      </div>
      <details className="text-xs text-slate-600" open={family}>
        <summary className="cursor-pointer font-medium">
          Technical evidence identity
        </summary>
        <div className="mt-2 break-all font-mono">
          {family ? 'Family tested revision' : 'Tested revision'}{' '}
          {evidence.verifiedRevision}
        </div>
      </details>
    </div>
  );
}

function ExactToolEvidence({ row }: { row: ToolFactoryRow }) {
  const evidence = row.verificationEvidence.exact;
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-slate-950">
        Latest exact Tool test
      </h3>
      {evidence ? (
        <div className="mt-3">
          <EvidenceResult evidence={evidence} family={false} />
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-amber-50 p-3">
          <div className="font-semibold text-amber-950">Not tested here</div>
          <p className="mt-1 text-sm text-amber-900">
            There is no retained test result for this exact Tool. A family
            policy or installed library is not counted as a pass.
          </p>
        </div>
      )}
    </section>
  );
}

function FamilyTestEvidence({ row }: { row: ToolFactoryRow }) {
  if (!row.verificationEvidence.family.length) return null;
  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <h3 className="text-sm font-semibold text-blue-950">
        Family test evidence — not an exact Tool test
      </h3>
      <p className="mt-1 text-sm text-blue-900">
        These runs covered this Tool as a named member of a broader family run.
        They do not replace the exact Tool test above.
      </p>
      <div className="mt-3 space-y-3">
        {row.verificationEvidence.family.map((evidence) => (
          <article
            key={evidence.evidenceId}
            className="rounded-md border border-blue-200 bg-white p-3"
          >
            <EvidenceResult evidence={evidence} family />
          </article>
        ))}
      </div>
    </section>
  );
}

function FamilyVerificationPolicy({ row }: { row: ToolFactoryRow }) {
  return (
    <section className="rounded-lg border bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-950">
        Family verification policy (not an exact Tool test)
      </h3>
      <p className="mt-2 text-sm text-slate-800">
        {familyPolicyExplanation(row)}
      </p>
      <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium">
          Technical policy detail
        </summary>
        <p className="mt-2">
          {row.controlledVerification.classification} —{' '}
          {row.controlledVerification.reason}
        </p>
      </details>
    </section>
  );
}

function ToolDetail({
  row,
  onClose,
}: {
  row: ToolFactoryRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      {row && (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{row.name}</DialogTitle>
            <DialogDescription className="font-mono">
              {row.toolId}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-3 md:grid-cols-2">
            <Fact label="Support disposition" value={row.support.disposition} />
            <Fact label="Operation" value={operationLabel(row)} />
            <Fact label="Family" value={row.family} />
            <Fact label="Adapter" value={row.support.adapterId ?? '—'} />
            <Fact label="Library / engine" value={engineNames(row)} />
            <Fact label="Execution profile" value={profiles(row)} />
            <Fact
              label="Runtime requirement"
              value={`${row.runtimeRequirement.classification} — ${row.runtimeRequirement.reason}`}
            />
            <Fact
              label="Runtime observation"
              value={`${row.runtimeObservation.classification} — ${row.runtimeObservation.reason}`}
            />
            <Fact label="Route" value={row.route} />
          </dl>
          <ExactToolEvidence row={row} />
          <FamilyTestEvidence row={row} />
          <FamilyVerificationPolicy row={row} />
          <Fact label="Catalog description" value={row.description} />
          <Fact label="Support reason" value={row.support.reason ?? '—'} />
          <Fact label="Attention" value={row.attention.summary} />
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Implementation ownership
            </div>
            {row.implementation.engines.length ? (
              <ul className="mt-2 space-y-2 text-sm">
                {row.implementation.engines.map((engine) => (
                  <li key={engine.id} className="rounded-md bg-slate-50 p-2">
                    <strong>{engine.identity}</strong>
                    <div className="mt-1 font-mono text-xs text-slate-600">
                      {engine.owner}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-700">
                {row.implementation.reason ?? 'No mapped engine.'}
                {row.implementation.sourceNeeded
                  ? ` Needed: ${row.implementation.sourceNeeded}`
                  : ''}
              </p>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function ToolFactoryTable({
  deployment,
  model,
}: {
  deployment: ToolFactoryDeployment;
  model: ToolFactoryTableModel;
}) {
  const [view, setView] = useState<ToolFactoryViewState>(
    DEFAULT_TOOL_FACTORY_VIEW,
  );
  const [selected, setSelected] = useState<ToolFactoryRow | null>(null);

  const supportValues = useMemo(
    () => unique(model.rows, (row) => row.support.disposition),
    [model.rows],
  );
  const familyValues = useMemo(
    () => unique(model.rows, (row) => row.family),
    [model.rows],
  );
  const profileValues = useMemo(
    () => unique(model.rows, profiles),
    [model.rows],
  );
  const verificationValues = useMemo(
    () =>
      unique(model.rows, (row) => row.controlledVerification.classification),
    [model.rows],
  );
  const rows = useMemo(() => [...model.rows], [model.rows]);

  useEffect(() => {
    function restoreFromUrl() {
      setView(
        parseToolFactoryView(globalThis.location.search, {
          families: familyValues,
          profiles: profileValues,
        }),
      );
    }

    restoreFromUrl();
    globalThis.addEventListener('popstate', restoreFromUrl);
    return () => globalThis.removeEventListener('popstate', restoreFromUrl);
  }, [familyValues, profileValues]);

  const commitView = useCallback(
    (next: ToolFactoryViewState, historyMode: 'push' | 'replace' = 'push') => {
      setView(next);
      const href = `${globalThis.location.pathname}${serializeToolFactoryView(next)}${globalThis.location.hash}`;
      if (historyMode === 'replace') {
        globalThis.history.replaceState(null, '', href);
      } else {
        globalThis.history.pushState(null, '', href);
      }
    },
    [],
  );

  const sorting = view.sorting as SortingState;
  const columnFilters: ColumnFiltersState = [];
  if (view.filters.support) {
    columnFilters.push({ id: 'support', value: view.filters.support });
  }
  if (view.filters.family) {
    columnFilters.push({ id: 'family', value: view.filters.family });
  }
  if (view.filters.profile) {
    columnFilters.push({ id: 'profiles', value: view.filters.profile });
  }
  if (view.filters.verification) {
    columnFilters.push({
      id: 'verification',
      value: view.filters.verification,
    });
  }
  const columnVisibility: VisibilityState = Object.fromEntries(
    TOOL_FACTORY_COLUMN_IDS.map((id) => [id, view.visibleColumns.includes(id)]),
  );
  const pagination: PaginationState = {
    pageIndex: view.pageIndex,
    pageSize: view.pageSize,
  };

  function resolveUpdate<T>(updater: Updater<T>, previous: T) {
    return typeof updater === 'function'
      ? (updater as (value: T) => T)(previous)
      : updater;
  }

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter: view.search,
      pagination,
    },
    onSortingChange: (updater) => {
      const next = resolveUpdate(updater, sorting)
        .filter((entry) =>
          TOOL_FACTORY_COLUMN_IDS.includes(entry.id as ToolFactoryColumnId),
        )
        .slice(0, 1) as ToolFactoryViewState['sorting'];
      commitView({ ...view, sorting: next, pageIndex: 0 });
    },
    onColumnVisibilityChange: (updater) => {
      const next = resolveUpdate(updater, columnVisibility);
      const visibleColumns = TOOL_FACTORY_COLUMN_IDS.filter(
        (id) => next[id] !== false,
      );
      commitView({
        ...view,
        visibleColumns: visibleColumns.length
          ? visibleColumns
          : view.visibleColumns,
      });
    },
    onPaginationChange: (updater) => {
      const next = resolveUpdate(updater, pagination);
      commitView({
        ...view,
        pageIndex: Math.max(0, next.pageIndex),
        pageSize: next.pageSize as 25 | 50 | 100,
      });
    },
    globalFilterFn: (row, _columnId, value: string) =>
      JSON.stringify(row.original).toLowerCase().includes(value.toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    columnResizeMode: 'onChange',
    autoResetPageIndex: false,
  });

  const filteredRowCount = table.getFilteredRowModel().rows.length;
  useEffect(() => {
    const pageIndex = clampToolFactoryPageIndex(
      view.pageIndex,
      filteredRowCount,
      view.pageSize,
    );
    if (pageIndex === view.pageIndex) return;
    commitView({ ...view, pageIndex }, 'replace');
  }, [commitView, filteredRowCount, view]);

  function setFilter(
    filter: keyof ToolFactoryViewState['filters'],
    value: string,
  ) {
    commitView({
      ...view,
      filters: { ...view.filters, [filter]: value },
      pageIndex: 0,
    });
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 lg:px-8">
      <div className="mx-auto max-w-[1800px] space-y-4">
        <header>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-widest">
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-800">
              {deployment.environment}
            </span>
            <span className="text-slate-600">
              Read only · source-owned facts
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            All Tools
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {model.rows.length.toLocaleString()} active Tools ·{' '}
            {model.counts.supported.toLocaleString()} supported ·{' '}
            {model.counts.unsupported.toLocaleString()} explicitly unsupported ·{' '}
            {model.counts.unknown.toLocaleString()} unknown
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            Revision {deployment.revision}
          </p>
        </header>

        <section className="rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <Input
              aria-label="Search all Tools"
              className="min-w-64 flex-1 lg:max-w-md"
              placeholder="Search every Tool and detail…"
              value={view.search}
              onChange={(event) => {
                commitView(
                  { ...view, search: event.target.value, pageIndex: 0 },
                  'replace',
                );
              }}
            />
            <select
              aria-label="Filter by support"
              className="h-9 rounded-md border bg-white px-3 text-sm"
              value={view.filters.support}
              onChange={(event) => setFilter('support', event.target.value)}
            >
              <option value="">All support</option>
              {supportValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Filter by family"
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              value={view.filters.family}
              onChange={(event) => setFilter('family', event.target.value)}
            >
              <option value="">All families</option>
              {familyValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Filter by execution profile"
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              value={view.filters.profile}
              onChange={(event) => setFilter('profile', event.target.value)}
            >
              <option value="">All execution profiles</option>
              {profileValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Filter by verification"
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              value={view.filters.verification}
              onChange={(event) =>
                setFilter('verification', event.target.value)
              }
            >
              <option value="">All verification</option>
              {verificationValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <details className="relative">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border bg-white px-3 text-sm font-medium shadow-xs hover:bg-slate-50">
                Columns <ChevronDown className="size-4" />
              </summary>
              <div className="absolute right-0 z-30 mt-2 max-h-96 w-72 overflow-y-auto rounded-md border bg-white p-2 shadow-xl">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={table.getIsAllColumnsVisible()}
                    onChange={table.getToggleAllColumnsVisibilityHandler()}
                  />
                  Show all
                </label>
                <div className="my-1 border-t" />
                {table.getAllLeafColumns().map((column) => (
                  <label
                    key={column.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                    />
                    {typeof column.columnDef.header === 'string'
                      ? column.columnDef.header
                      : column.id}
                  </label>
                ))}
              </div>
            </details>
            <Button
              variant="outline"
              onClick={() => {
                commitView(DEFAULT_TOOL_FACTORY_VIEW);
              }}
            >
              Reset
            </Button>
          </div>

          <div className="overflow-auto">
            <table
              className="w-full table-fixed border-collapse text-sm"
              style={{ width: table.getCenterTotalSize() }}
            >
              <thead className="sticky top-0 z-10 bg-slate-50">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b">
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="relative h-11 px-3 text-left align-middle text-xs font-medium"
                        style={{ width: header.getSize() }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                        {header.column.getCanResize() && (
                          <button
                            type="button"
                            aria-label={`Resize ${header.column.id} column`}
                            className="absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none hover:bg-blue-400"
                            onDoubleClick={() => header.column.resetSize()}
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                          />
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    tabIndex={0}
                    className="cursor-pointer border-b bg-white hover:bg-slate-50 focus:bg-blue-50 focus:outline-none"
                    onClick={() => setSelected(row.original)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setSelected(row.original);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="truncate px-3 py-2.5 align-top text-slate-700"
                        style={{ width: cell.column.getSize() }}
                        title={String(cell.getValue() ?? '')}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {!table.getRowModel().rows.length && (
                  <tr>
                    <td
                      className="h-32 text-center text-slate-500"
                      colSpan={table.getVisibleLeafColumns().length}
                    >
                      No Tools match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm">
            <div className="text-slate-600">
              {table.getFilteredRowModel().rows.length.toLocaleString()}{' '}
              matching Tools · page {table.getState().pagination.pageIndex + 1}{' '}
              of {Math.max(table.getPageCount(), 1)}
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="Rows per page"
                className="h-9 rounded-md border bg-white px-2"
                value={table.getState().pagination.pageSize}
                onChange={(event) =>
                  table.setPageSize(Number(event.target.value))
                }
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} rows
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        </section>
      </div>
      <ToolDetail row={selected} onClose={() => setSelected(null)} />
    </main>
  );
}

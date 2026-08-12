'use client';

// THROWAWAY PROTOTYPE: one real-data shadcn/TanStack table for all Tools.
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@serp-tools/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@serp-tools/ui/components/dialog';
import { Input } from '@serp-tools/ui/components/input';

export type ToolRow = {
  id: string;
  name: string;
  description: string;
  route: string;
  operation: string;
  from: string | null;
  to: string | null;
  renderer: string;
  disposition: string;
  family: string;
  libraries: string[];
  engineIds: string[];
  processingLocations: string[];
  executionProfiles: string[];
  runtimeFit: string;
  runtimeReason: string;
  verification: string;
  verificationReason: string;
  adapter: string | null;
  blockers: { code: string; detail: string }[];
  feasibility: string;
  priority: number;
};

export type Recommendation = {
  id: string;
  title: string;
  count: number;
  expectedCoverageDelta: number;
  toolIds: string[];
  dependencies: string[];
  risks: string[];
  semanticTestStrategy: string;
};

export type PrototypeData = {
  revision: string;
  scope: { environment: string; productionAccess: boolean; definition: string };
  portfolio: {
    activeToolCount: number;
    counts: {
      supported: number;
      unsupported: number;
      unwired: number;
      unknown: number;
    };
  };
  rows: ToolRow[];
};

type HeadlineStatus =
  | 'Working and verified'
  | 'Expected to work, not verified'
  | 'Unsupported'
  | 'Broken'
  | 'Unknown';

function headlineStatus(row: ToolRow): HeadlineStatus {
  if (row.disposition === 'supported') return 'Working and verified';
  if (row.disposition === 'unsupported') return 'Unsupported';
  if (row.disposition === 'unwired') return 'Expected to work, not verified';
  return 'Unknown';
}

function operationLabel(row: ToolRow) {
  if (row.from || row.to) return `${row.from ?? '—'} → ${row.to ?? '—'}`;
  return row.operation.replaceAll('-', ' ');
}

function joined(values: string[]) {
  return values.length ? values.join(', ') : '—';
}

function attentionLabel(row: ToolRow) {
  if (row.blockers.length)
    return row.blockers.map((item) => item.code).join(', ');
  if (headlineStatus(row) === 'Working and verified') return 'None';
  return row.runtimeReason || row.verificationReason || 'Needs review';
}

function StatusBadge({ status }: { status: HeadlineStatus }) {
  const tone =
    status === 'Working and verified'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : status === 'Unsupported'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : status === 'Broken'
          ? 'border-red-200 bg-red-50 text-red-800'
          : status === 'Unknown'
            ? 'border-slate-300 bg-slate-100 text-slate-700'
            : 'border-blue-200 bg-blue-50 text-blue-800';
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-xs font-medium ${tone}`}
    >
      {status}
    </span>
  );
}

function SortButton({
  column,
  label,
}: {
  column: Column<ToolRow>;
  label: string;
}) {
  const state = column.getIsSorted();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-950"
      onClick={column.getToggleSortingHandler()}
    >
      {label}
      {state === 'asc' ? (
        <ArrowUp className="size-3.5" />
      ) : state === 'desc' ? (
        <ArrowDown className="size-3.5" />
      ) : (
        <ArrowUpDown className="size-3.5 text-slate-400" />
      )}
    </button>
  );
}

const columns: ColumnDef<ToolRow>[] = [
  {
    id: 'tool',
    accessorFn: (row) => `${row.name} ${row.id}`,
    header: ({ column }) => <SortButton column={column} label="Tool" />,
    cell: ({ row }) => (
      <div className="min-w-52">
        <div className="font-medium text-slate-950">{row.original.name}</div>
        <div className="font-mono text-xs text-slate-500">
          {row.original.id}
        </div>
      </div>
    ),
    size: 270,
  },
  {
    id: 'status',
    accessorFn: headlineStatus,
    header: ({ column }) => <SortButton column={column} label="Status" />,
    cell: ({ row }) => <StatusBadge status={headlineStatus(row.original)} />,
    size: 190,
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
    id: 'libraries',
    accessorFn: (row) => joined(row.libraries),
    header: ({ column }) => (
      <SortButton column={column} label="Library / engine" />
    ),
    size: 280,
  },
  {
    id: 'runtime',
    accessorFn: (row) =>
      joined([...row.processingLocations, ...row.executionProfiles]),
    header: ({ column }) => <SortButton column={column} label="Runs in" />,
    size: 220,
  },
  {
    accessorKey: 'verification',
    header: ({ column }) => <SortButton column={column} label="Verification" />,
    size: 190,
  },
  {
    id: 'attention',
    accessorFn: attentionLabel,
    header: ({ column }) => <SortButton column={column} label="Attention" />,
    size: 240,
  },
  { accessorKey: 'id', header: 'Tool ID', size: 210 },
  { accessorKey: 'description', header: 'Description', size: 360 },
  { accessorKey: 'route', header: 'Route', size: 220 },
  { accessorKey: 'operation', header: 'Operation type', size: 160 },
  { accessorKey: 'from', header: 'Input format', size: 130 },
  { accessorKey: 'to', header: 'Output format', size: 130 },
  { accessorKey: 'renderer', header: 'Renderer', size: 170 },
  { accessorKey: 'disposition', header: 'Disposition', size: 160 },
  {
    id: 'engineIds',
    accessorFn: (row) => joined(row.engineIds),
    header: 'Engine IDs',
    size: 280,
  },
  {
    id: 'processingLocations',
    accessorFn: (row) => joined(row.processingLocations),
    header: 'Processing locations',
    size: 220,
  },
  {
    id: 'executionProfiles',
    accessorFn: (row) => joined(row.executionProfiles),
    header: 'Execution profiles',
    size: 220,
  },
  { accessorKey: 'runtimeFit', header: 'Runtime fit', size: 180 },
  { accessorKey: 'runtimeReason', header: 'Runtime reason', size: 360 },
  {
    accessorKey: 'verificationReason',
    header: 'Verification reason',
    size: 360,
  },
  { accessorKey: 'adapter', header: 'Adapter', size: 220 },
  {
    id: 'blockerDetails',
    accessorFn: (row) =>
      row.blockers.map((item) => `${item.code}: ${item.detail}`).join(' · ') ||
      '—',
    header: 'Blocker details',
    size: 420,
  },
  { accessorKey: 'feasibility', header: 'Feasibility', size: 190 },
  { accessorKey: 'priority', header: 'Priority', size: 100 },
];

const initiallyHidden: VisibilityState = {
  id: false,
  description: false,
  route: false,
  operation: false,
  from: false,
  to: false,
  renderer: false,
  disposition: false,
  engineIds: false,
  processingLocations: false,
  executionProfiles: false,
  runtimeFit: false,
  runtimeReason: false,
  verificationReason: false,
  adapter: false,
  blockerDetails: false,
  feasibility: false,
  priority: false,
};

function unique(rows: ToolRow[], value: (row: ToolRow) => string) {
  return [...new Set(rows.map(value).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function Detail({
  row,
  onClose,
}: {
  row: ToolRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      {row && (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{row.name}</DialogTitle>
            <DialogDescription className="font-mono">
              {row.id}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 text-sm md:grid-cols-2">
            {[
              ['Status', headlineStatus(row)],
              ['Operation', operationLabel(row)],
              ['Family', row.family],
              ['Library / engine', joined(row.libraries)],
              [
                'Runs in',
                joined([...row.processingLocations, ...row.executionProfiles]),
              ],
              ['Runtime fit', `${row.runtimeFit} — ${row.runtimeReason}`],
              [
                'Verification',
                `${row.verification} — ${row.verificationReason}`,
              ],
              ['Adapter', row.adapter ?? '—'],
              ['Renderer', row.renderer],
              ['Feasibility', row.feasibility],
              ['Priority', String(row.priority)],
              ['Route', row.route],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-slate-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {label}
                </div>
                <div className="mt-1 break-words text-slate-900">{value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Description
            </div>
            <p className="mt-1 text-slate-800">{row.description}</p>
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Attention / blockers
            </div>
            {row.blockers.length ? (
              <ul className="mt-2 space-y-2">
                {row.blockers.map((item) => (
                  <li key={`${item.code}-${item.detail}`}>
                    <span className="font-medium">{item.code}:</span>{' '}
                    {item.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">None recorded.</p>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function FactoryPrototype({ data }: { data: PrototypeData }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(initiallyHidden);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });
  const [selected, setSelected] = useState<ToolRow | null>(null);

  const statusValues = useMemo(
    () => unique(data.rows, (row) => headlineStatus(row)),
    [data.rows],
  );
  const familyValues = useMemo(
    () => unique(data.rows, (row) => row.family),
    [data.rows],
  );
  const runtimeValues = useMemo(
    () =>
      unique(data.rows, (row) =>
        joined([...row.processingLocations, ...row.executionProfiles]),
      ),
    [data.rows],
  );
  const verificationValues = useMemo(
    () => unique(data.rows, (row) => row.verification),
    [data.rows],
  );

  const table = useReactTable({
    data: data.rows,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _columnId, filterValue: string) =>
      JSON.stringify(row.original)
        .toLowerCase()
        .includes(filterValue.toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    columnResizeMode: 'onChange',
  });

  function setFilter(columnId: string, value: string) {
    table.getColumn(columnId)?.setFilterValue(value || undefined);
    table.setPageIndex(0);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 lg:px-8">
      <div className="mx-auto max-w-[1800px] space-y-4">
        <header>
          <div className="text-xs font-medium uppercase tracking-widest text-amber-700">
            Throwaway prototype · table only · read only
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            All Tools
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {data.portfolio.activeToolCount.toLocaleString()} Tools from source
            revision {data.revision.slice(0, 7)}. Click any row for every
            recorded detail.
          </p>
        </header>

        <section className="rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <Input
              aria-label="Search all Tools"
              className="min-w-64 flex-1 lg:max-w-md"
              placeholder="Search every Tool and detail…"
              value={globalFilter}
              onChange={(event) => {
                setGlobalFilter(event.target.value);
                table.setPageIndex(0);
              }}
            />
            <select
              className="h-9 rounded-md border bg-white px-3 text-sm"
              aria-label="Filter by status"
              onChange={(event) => setFilter('status', event.target.value)}
            >
              <option value="">All statuses</option>
              {statusValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              aria-label="Filter by family"
              onChange={(event) => setFilter('family', event.target.value)}
            >
              <option value="">All families</option>
              {familyValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              aria-label="Filter by runtime"
              onChange={(event) => setFilter('runtime', event.target.value)}
            >
              <option value="">All runtimes</option>
              {runtimeValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              aria-label="Filter by verification"
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
                  />{' '}
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
                setGlobalFilter('');
                setColumnFilters([]);
                setSorting([]);
                setColumnVisibility(initiallyHidden);
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
                            onDoubleClick={() => header.column.resetSize()}
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            className="absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none hover:bg-blue-400"
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
                      colSpan={table.getVisibleLeafColumns().length}
                      className="h-32 text-center text-slate-500"
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
                className="h-9 rounded-md border bg-white px-2"
                aria-label="Rows per page"
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
      <Detail row={selected} onClose={() => setSelected(null)} />
    </main>
  );
}

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
import Link from 'next/link';
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
import type { ToolClientFirstRow } from '../../../lib/tool-client-first-plan.ts';
import type {
  ToolExpansionGroup,
  ToolExpansionPlan,
} from '../../../lib/tool-expansion-planner.ts';
import type { ToolGithubWorkScopeView } from '../../../lib/tool-github-work-links.ts';
import type { ToolFactoryDeployment } from '../../../lib/tool-factory-access.ts';
import type { ToolRuntimeObservationPortfolio } from '../../../lib/tool-runtime-observations.ts';
import type { GoldenToolJourneyPilotView } from '../../../lib/golden-tool-journey-pilot.ts';
import { presentToolRuntimeObservations } from '../../../lib/tool-runtime-observation-presentation.ts';
import { journeyEvidenceLabel } from '../../../lib/tool-verification-presentation.ts';
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

function GoldenPilotPanel({ pilot }: { pilot: GoldenToolJourneyPilotView }) {
  return (
    <section
      aria-labelledby="golden-pilot-heading"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="golden-pilot-heading" className="text-lg font-semibold">
            Golden Journey pilot
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-700">
            Ten fixed user journeys connect real Tool behavior to retained
            evidence. This is a bounded decision sample, not a claim about all
            Tools.
          </p>
        </div>
        <Link
          className="rounded-md border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
          href="/internal/tools/"
        >
          Return to all Tools
        </Link>
      </div>
      <p className="mt-2 font-mono text-xs text-slate-600">
        Fixed membership {pilot.membershipHash}
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-[1100px] w-full border-collapse text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="p-3">Journey</th>
              <th className="p-3">Current result</th>
              <th className="p-3">Where it runs</th>
              <th className="p-3">What was checked</th>
              <th className="p-3">Freshness</th>
              <th className="p-3">Remaining gap</th>
              <th className="p-3">Try it</th>
            </tr>
          </thead>
          <tbody>
            {pilot.rows.map((row) => (
              <tr key={row.journeyId} className="border-t align-top">
                <td className="p-3">
                  <strong>{row.toolName}</strong>
                  <div className="font-mono text-xs text-slate-500">
                    {row.journeyId}
                  </div>
                </td>
                <td className="p-3 font-medium">{row.resultLabel}</td>
                <td className="p-3">{row.whereItRuns}</td>
                <td className="p-3">{row.checkedBehavior}</td>
                <td className="p-3">{row.freshness}</td>
                <td className="max-w-md p-3 text-slate-700">
                  {row.remainingGap}
                </td>
                <td className="p-3">
                  <a
                    className="font-medium text-blue-700 underline underline-offset-2"
                    href={row.tryHref}
                  >
                    Open Tool
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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

function candidateProfiles(row: ToolFactoryRow) {
  return joined(row.runtimeRequirement.executionProfiles);
}

function executionLabel(
  state: ToolClientFirstRow['currentExecution']['state'],
) {
  return {
    browser: 'Browser',
    hybrid: 'Hybrid',
    server: 'Server',
    unsupported: 'Unsupported',
    unknown: 'Unknown',
  }[state];
}

function targetLabel(target: ToolClientFirstRow['preferredTarget']) {
  return {
    'browser-first': 'Browser-first',
    'server-required': 'Server required',
    undecided: 'Undecided',
  }[target];
}

function serverDependencyLabel(
  dependency: ToolClientFirstRow['serverDependency'],
) {
  return {
    none: 'None',
    'optional-fallback': 'Optional / conditional',
    required: 'Required',
    unknown: 'Unknown',
  }[dependency];
}

function browserOpportunityLabel(
  value: ToolClientFirstRow['browserFeasibility'],
) {
  return {
    'existing-browser-path': 'Existing browser code to verify',
    'new-browser-library': 'Research a browser library',
    'server-required': 'Server required',
    'catalog-review': 'Review the Tool idea',
    unresolved: 'Unresolved',
  }[value];
}

const verifiedDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

function formatVerifiedDate(verifiedAt: string) {
  return verifiedDateFormatter.format(new Date(verifiedAt));
}

function exactTestLabel(row: ToolFactoryRow) {
  const withEvidence = row.verificationEvidence.filter(
    (evidence) => evidence.latest !== null,
  );
  if (!withEvidence.length) return 'No journey evidence';
  const verified = withEvidence.filter(
    (evidence) => evidence.state === 'verified',
  ).length;
  return verified
    ? `${verified} of ${row.journeys.length} journeys verified`
    : `${withEvidence.length} journey result${withEvidence.length === 1 ? '' : 's'} · none verified`;
}

function runtimeObservationLabel(
  portfolio: ToolRuntimeObservationPortfolio,
  toolId: string,
) {
  if (portfolio.state === 'unavailable') return 'Not available';
  const tool = portfolio.tools.find((candidate) => candidate.toolId === toolId);
  if (!tool) return 'No recent staging data';
  const latest = tool.paths
    .filter((path) => path.state === 'observed')
    .sort((left, right) =>
      right.state === 'observed' && left.state === 'observed'
        ? right.lastObservedAt.localeCompare(left.lastObservedAt)
        : 0,
    )[0];
  if (!latest || latest.state !== 'observed') return 'No recent staging data';
  return `${latest.lastResult === 'succeeded' ? 'Succeeded' : 'Failed'} · ${latest.label} · ${latest.freshness}`;
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

function buildColumns(
  clientFirstByToolId: ReadonlyMap<string, ToolClientFirstRow>,
): ColumnDef<ToolFactoryRow>[] {
  const planning = (row: ToolFactoryRow) => {
    const result = clientFirstByToolId.get(row.toolId);
    if (!result)
      throw new TypeError(`Missing client-first plan for ${row.toolId}`);
    return result;
  };
  return [
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
      id: 'currentExecution',
      accessorFn: (row) => executionLabel(planning(row).currentExecution.state),
      header: ({ column }) => <SortButton column={column} label="Runs today" />,
      size: 150,
    },
    {
      id: 'preferredTarget',
      accessorFn: (row) => targetLabel(planning(row).preferredTarget),
      header: ({ column }) => (
        <SortButton column={column} label="Preferred target" />
      ),
      size: 170,
    },
    {
      id: 'serverDependency',
      accessorFn: (row) =>
        serverDependencyLabel(planning(row).serverDependency),
      header: ({ column }) => (
        <SortButton column={column} label="Server dependency" />
      ),
      size: 190,
    },
    {
      id: 'browserFeasibility',
      accessorFn: (row) =>
        browserOpportunityLabel(planning(row).browserFeasibility),
      header: 'Browser opportunity',
      size: 210,
    },
    {
      id: 'currentEngines',
      accessorFn: (row) => joined(planning(row).currentExecution.engineIds),
      header: 'Current engine',
      size: 250,
    },
    {
      id: 'candidateEngines',
      accessorFn: (row) =>
        joined(planning(row).candidateEngines.map((engine) => engine.identity)),
      header: 'Candidate approach · not verified',
      size: 340,
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
      accessorFn: candidateProfiles,
      header: ({ column }) => (
        <SortButton column={column} label="Mapped candidate profiles" />
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
      id: 'observation',
      accessorFn: (row) => row.runtimeObservation.classification,
      header: ({ column }) => (
        <SortButton column={column} label="Recent staging" />
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
}

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

const blockerLabels = {
  adapter: 'adapter',
  'browser-runtime-fit': 'browser/runtime fit',
  fixture: 'fixture',
  'semantic-validator': 'semantic validator',
  limits: 'limits',
  licensing: 'licensing',
  'maintenance-review': 'maintenance review',
} as const;

function ExpansionGroupCard({
  group,
  active,
  onSelect,
}: {
  group: ToolExpansionGroup;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      aria-label={`Rank ${group.rank} ${group.operationFamily}`}
      className={`rounded-lg border p-4 ${active ? 'border-blue-500 bg-blue-50' : 'bg-white'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Rank {group.rank}
          </div>
          <h3 className="font-mono text-sm font-semibold text-slate-950">
            {group.operationFamily}
          </h3>
          <p className="mt-1 text-sm font-medium text-blue-800">
            {group.unlockCount.toLocaleString()} exact Tools
          </p>
        </div>
        <Button
          size="sm"
          variant={active ? 'default' : 'outline'}
          onClick={onSelect}
        >
          Show {group.unlockCount.toLocaleString()} exact Tools
        </Button>
      </div>
      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="font-medium text-slate-600">Input formats</dt>
          <dd className="break-words text-slate-900">
            {joined(group.inputFormats)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">Output formats</dt>
          <dd className="break-words text-slate-900">
            {joined(group.outputFormats)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">
            Candidate libraries / engines
          </dt>
          <dd className="space-y-1 text-slate-900">
            {group.candidateEngines.map((engine) => (
              <div key={engine.id}>
                {engine.identity}
                <span className="ml-1 text-xs text-slate-500">
                  (candidate only)
                </span>
              </div>
            ))}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-600">Execution locations</dt>
          <dd className="text-slate-900">{joined(group.executionLocations)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {group.blockers.map((blocker) => (
          <span
            key={blocker.kind}
            title={blocker.explanation}
            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"
          >
            {blockerLabels[blocker.kind]} · {blocker.status.replace('-', ' ')}
          </span>
        ))}
      </div>
      <details className="mt-3 text-sm text-slate-700">
        <summary className="cursor-pointer font-medium">
          Facts, assumptions, and exact Tool IDs
        </summary>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div>
            <h4 className="font-medium text-slate-900">Facts</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {group.facts.map((fact) => (
                <li key={fact.statement}>
                  {fact.statement}{' '}
                  <span className="text-xs text-slate-500">
                    Source: {fact.source}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-slate-900">Assumptions</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {group.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-3 break-words font-mono text-xs text-slate-600">
          {group.toolIds.join(', ')}
        </p>
      </details>
    </article>
  );
}

function ToolExpansionPlanner({
  plan,
  activeGroupId,
  onSelect,
}: {
  plan: ToolExpansionPlan;
  activeGroupId: string | null;
  onSelect: (group: ToolExpansionGroup) => void;
}) {
  return (
    <section
      aria-label="OSS expansion planner"
      className="rounded-xl border bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">OSS expansion planner</h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">
            {plan.groups.length.toLocaleString()} review groups account for all{' '}
            {plan.unsupportedToolCount.toLocaleString()} explicitly unsupported
            Tools. Ranking method: {plan.ranking.method}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          Read-only planning
        </span>
      </div>
      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-950">
        {plan.supportNotice}
      </p>
      <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
        <strong>Ranking assumptions:</strong>{' '}
        {plan.ranking.assumptions.join(' ')}
      </div>
      <details className="mt-3" open>
        <summary className="cursor-pointer text-sm font-medium text-slate-900">
          Review all {plan.groups.length.toLocaleString()} groups
        </summary>
        <div className="mt-3 max-h-[42rem] space-y-3 overflow-y-auto pr-1">
          {plan.groups.map((group) => (
            <ExpansionGroupCard
              key={group.id}
              group={group}
              active={activeGroupId === group.id}
              onSelect={() => onSelect(group)}
            />
          ))}
        </div>
      </details>
    </section>
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

function JourneyVerificationEvidence({ row }: { row: ToolFactoryRow }) {
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-slate-950">
        Journey verification evidence
      </h3>
      <p className="mt-1 text-sm text-slate-700">
        Each card is one exact way a person can use this Tool. A package, family
        policy, warning, skip, or partial browser check is never counted as a
        verified journey.
      </p>
      <div className="mt-3 space-y-3">
        {row.verificationEvidence.map((evidence) => {
          const journey = row.journeys.find(
            (candidate) => candidate.id === evidence.journeyId,
          );
          return (
            <article
              key={evidence.journeyId}
              className="rounded-md border bg-slate-50 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-950">
                    {journey?.input.kind ?? evidence.journeyId}
                  </div>
                  <div className="font-mono text-xs text-slate-500">
                    {evidence.journeyId}
                  </div>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-800">
                  {journeyEvidenceLabel(evidence.state)}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{evidence.reason}</p>
              {evidence.missingChecks.length ? (
                <p className="mt-2 text-xs text-amber-800">
                  Still needed: {evidence.missingChecks.join(', ')}
                </p>
              ) : null}
              {evidence.latest ? (
                <details className="mt-2 text-xs text-slate-600">
                  <summary className="cursor-pointer font-medium">
                    Exact evidence identity
                  </summary>
                  <div className="mt-2 space-y-1 break-all font-mono">
                    <div>{evidence.latest.runId}</div>
                    <div>{evidence.latest.environment}</div>
                    <div>{formatVerifiedDate(evidence.latest.observedAt)}</div>
                    <div>{evidence.latest.revision.commit}</div>
                  </div>
                </details>
              ) : null}
            </article>
          );
        })}
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

function journeyInputLabel(
  kind: ToolFactoryRow['journeys'][number]['input']['kind'],
) {
  return {
    file: 'File upload',
    'multiple-files': 'Multiple file upload',
    text: 'Entered text',
    'direct-url': 'Direct media URL',
    'extractor-url': 'YouTube or extractor URL',
    'local-editor': 'Local editor interaction',
    unknown: 'Unknown input path',
  }[kind];
}

function ToolJourneys({ row }: { row: ToolFactoryRow }) {
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-slate-950">User journeys</h3>
      <p className="mt-1 text-sm text-slate-600">
        Each path is verified separately. Listing a journey here is not a test
        result.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {row.journeys.map((journey) => (
          <article key={journey.id} className="rounded-md bg-slate-50 p-3">
            <h4 className="text-sm font-semibold text-slate-900">
              {journeyInputLabel(journey.input.kind)}
            </h4>
            <dl className="mt-2 space-y-1 text-sm">
              <div>
                <dt className="inline text-slate-500">Needs: </dt>
                <dd className="inline font-medium">
                  {journey.requiredEnvironment === 'browser'
                    ? 'Browser'
                    : journey.requiredEnvironment === 'preview'
                      ? 'DEV/STAGING preview'
                      : 'Unknown environment'}
                </dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Must prove: </dt>
                <dd className="inline font-medium">
                  {journey.semanticInvariant.id ?? 'Not defined yet'}
                </dd>
              </div>
            </dl>
            <p className="mt-2 font-mono text-xs text-slate-500">
              {journey.id}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GithubWorkList({ scope }: { scope: ToolGithubWorkScopeView }) {
  if (!scope.links.length) {
    return (
      <p className="mt-2 text-sm text-slate-600">
        {scope.coverage === 'complete'
          ? 'No tracked work'
          : 'Work tracking not loaded'}
      </p>
    );
  }
  return (
    <>
      <ul className="mt-2 space-y-2">
        {scope.links.map((link) => {
          const current = link.state === 'open';
          return (
            <li
              key={`${link.kind}:${link.number}`}
              className="rounded-md border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    current
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {link.stateLabel}
                </span>
                <span className="font-mono text-xs text-slate-500">
                  #{link.number}
                </span>
              </div>
              <a
                className="mt-2 block text-sm font-medium text-blue-700 underline underline-offset-4 hover:text-blue-900"
                href={link.url}
                rel="noreferrer"
                target="_blank"
              >
                {link.title}
              </a>
            </li>
          );
        })}
      </ul>
      {scope.coverage === 'partial' && (
        <p className="mt-2 text-xs text-amber-800">
          Additional tracked work may not be loaded.
        </p>
      )}
    </>
  );
}

function GithubWork({ row }: { row: ToolFactoryRow }) {
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-slate-950">GitHub work</h3>
      <p className="mt-1 text-sm text-slate-600">
        Read-only links from explicit Tool IDs and exact family membership.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Source: {row.githubWork.source.authority} ·{' '}
        {row.githubWork.source.repository} · observed{' '}
        {new Date(row.githubWork.source.observedAt).toLocaleString('en-US', {
          timeZone: 'UTC',
          timeZoneName: 'short',
        })}{' '}
        · revision {row.githubWork.source.revision.slice(0, 8)}.{' '}
        {row.githubWork.source.freshness}.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <h4 className="text-sm font-semibold text-slate-900">This Tool</h4>
          <GithubWorkList scope={row.githubWork.tool} />
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <h4 className="text-sm font-semibold text-slate-900">
            Family · {row.family}
          </h4>
          <GithubWorkList scope={row.githubWork.family} />
        </div>
      </div>
    </section>
  );
}

function RecentStagingActivity({
  portfolio,
  toolId,
}: {
  portfolio: ToolRuntimeObservationPortfolio;
  toolId: string;
}) {
  const presentation = presentToolRuntimeObservations(portfolio, toolId);
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-slate-950">
        {presentation.heading}
      </h3>
      {presentation.state === 'unavailable' ? (
        <div className="mt-3 rounded-md bg-amber-50 p-3">
          <div className="font-semibold text-amber-950">
            {presentation.title}
          </div>
          <p className="mt-1 text-sm text-amber-900">
            {presentation.explanation}
          </p>
        </div>
      ) : presentation.state === 'empty' ? (
        <div className="mt-3 rounded-md bg-slate-50 p-3">
          <div className="font-semibold text-slate-900">
            {presentation.title}
          </div>
          <p className="mt-1 text-sm text-slate-700">
            {presentation.explanation}
          </p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600">
            {presentation.sampleSummary}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {presentation.paths.map((path) => (
              <article key={path.label} className="rounded-lg bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">
                  {path.label}
                </h4>
                {path.state === 'observed' ? (
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-slate-500">Environment</dt>
                      <dd className="font-medium">{path.environment}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Attempts</dt>
                      <dd className="font-medium">
                        {path.attempts.toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Latest result</dt>
                      <dd className="font-medium">{path.latestResult}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Freshness</dt>
                      <dd className="font-medium">{path.freshness}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-slate-500">Last seen</dt>
                      <dd className="font-medium">
                        {new Date(path.lastSeenAt).toLocaleString('en-US', {
                          timeZone: 'UTC',
                          timeZoneName: 'short',
                        })}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">
                    {path.explanation}
                  </p>
                )}
              </article>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">{presentation.notice}</p>
        </>
      )}
    </section>
  );
}
function ToolDetail({
  row,
  clientFirst,
  runtimeObservations,
  onClose,
}: {
  row: ToolFactoryRow | null;
  clientFirst: ToolClientFirstRow | null;
  runtimeObservations: ToolRuntimeObservationPortfolio;
  onClose: () => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      {row && clientFirst && (
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
            <Fact
              label="Runs today"
              value={executionLabel(clientFirst.currentExecution.state)}
            />
            <Fact
              label="Preferred target"
              value={targetLabel(clientFirst.preferredTarget)}
            />
            <Fact
              label="Server dependency"
              value={serverDependencyLabel(clientFirst.serverDependency)}
            />
            <Fact
              label="Current engine"
              value={joined(clientFirst.currentExecution.engineIds)}
            />
            <Fact
              label="Current execution meaning"
              value={clientFirst.currentExecution.explanation}
            />
            <Fact
              label="Browser opportunity"
              value={browserOpportunityLabel(clientFirst.browserFeasibility)}
            />
            <Fact label="Route" value={row.route} />
          </dl>
          <ToolJourneys row={row} />
          <RecentStagingActivity
            portfolio={runtimeObservations}
            toolId={row.toolId}
          />
          <JourneyVerificationEvidence row={row} />
          <FamilyVerificationPolicy row={row} />
          <GithubWork row={row} />
          <Fact label="Catalog description" value={row.description} />
          <Fact label="Support reason" value={row.support.reason ?? '—'} />
          <Fact label="Attention" value={row.attention.summary} />
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Candidate approaches · not verified support
            </div>
            {clientFirst.candidateEngines.length ? (
              <ul className="mt-2 space-y-2 text-sm">
                {clientFirst.candidateEngines.map((engine) => (
                  <li key={engine.id} className="rounded-md bg-slate-50 p-2">
                    <strong>{engine.identity}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-700">
                No unverified candidate approach is recorded.
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
  clientFirstPlan,
  goldenPilot,
  expansionPlan,
  runtimeObservations,
}: {
  deployment: ToolFactoryDeployment;
  model: ToolFactoryTableModel;
  clientFirstPlan: Readonly<{ rows: readonly ToolClientFirstRow[] }>;
  goldenPilot: GoldenToolJourneyPilotView;
  expansionPlan: ToolExpansionPlan;
  runtimeObservations: ToolRuntimeObservationPortfolio;
}) {
  const [view, setView] = useState<ToolFactoryViewState>(
    DEFAULT_TOOL_FACTORY_VIEW,
  );
  const [selected, setSelected] = useState<ToolFactoryRow | null>(null);
  const clientFirstByToolId = useMemo(
    () => new Map(clientFirstPlan.rows.map((row) => [row.toolId, row])),
    [clientFirstPlan.rows],
  );

  const supportValues = useMemo(
    () => unique(model.rows, (row) => row.support.disposition),
    [model.rows],
  );
  const familyValues = useMemo(
    () => unique(model.rows, (row) => row.family),
    [model.rows],
  );
  const profileValues = useMemo(
    () =>
      [
        ...new Set(
          clientFirstPlan.rows.map((row) =>
            executionLabel(row.currentExecution.state),
          ),
        ),
      ].sort(),
    [clientFirstPlan.rows],
  );
  const targetValues = useMemo(
    () =>
      [
        ...new Set(clientFirstPlan.rows.map((row) => row.preferredTarget)),
      ].sort(),
    [clientFirstPlan.rows],
  );
  const serverDependencyValues = useMemo(
    () =>
      [
        ...new Set(clientFirstPlan.rows.map((row) => row.serverDependency)),
      ].sort(),
    [clientFirstPlan.rows],
  );
  const browserFeasibilityValues = useMemo(
    () =>
      [
        ...new Set(clientFirstPlan.rows.map((row) => row.browserFeasibility)),
      ].sort(),
    [clientFirstPlan.rows],
  );
  const verificationValues = useMemo(
    () =>
      unique(model.rows, (row) => row.controlledVerification.classification),
    [model.rows],
  );
  const activeExpansionGroup = useMemo(
    () =>
      expansionPlan.groups.find((group) => group.id === view.expansionGroup) ??
      null,
    [expansionPlan.groups, view.expansionGroup],
  );
  const rows = useMemo(() => {
    if (view.pilot === 'golden') {
      const memberIds = new Set(goldenPilot.rows.map((row) => row.toolId));
      return model.rows.filter((row) => memberIds.has(row.toolId));
    }
    if (!activeExpansionGroup) return [...model.rows];
    const memberIds = new Set(activeExpansionGroup.toolIds);
    return model.rows.filter((row) => memberIds.has(row.toolId));
  }, [activeExpansionGroup, goldenPilot.rows, model.rows, view.pilot]);

  useEffect(() => {
    function restoreFromUrl() {
      setView(
        parseToolFactoryView(globalThis.location.search, {
          families: familyValues,
          profiles: profileValues,
          expansionGroups: expansionPlan.groups.map((group) => group.id),
        }),
      );
    }

    restoreFromUrl();
    globalThis.addEventListener('popstate', restoreFromUrl);
    return () => globalThis.removeEventListener('popstate', restoreFromUrl);
  }, [expansionPlan.groups, familyValues, profileValues]);

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
  if (view.filters.currentExecution) {
    columnFilters.push({
      id: 'currentExecution',
      value: view.filters.currentExecution,
    });
  }
  if (view.filters.preferredTarget) {
    columnFilters.push({
      id: 'preferredTarget',
      value: view.filters.preferredTarget,
    });
  }
  if (view.filters.serverDependency) {
    columnFilters.push({
      id: 'serverDependency',
      value: view.filters.serverDependency,
    });
  }
  if (view.filters.browserFeasibility) {
    columnFilters.push({
      id: 'browserFeasibility',
      value: view.filters.browserFeasibility,
    });
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
  const tableColumns = useMemo(
    () =>
      buildColumns(clientFirstByToolId).map((column) =>
        column.id === 'observation'
          ? {
              ...column,
              accessorFn: (row: ToolFactoryRow) =>
                runtimeObservationLabel(runtimeObservations, row.toolId),
            }
          : column,
      ),
    [clientFirstByToolId, runtimeObservations],
  );

  function resolveUpdate<T>(updater: Updater<T>, previous: T) {
    return typeof updater === 'function'
      ? (updater as (value: T) => T)(previous)
      : updater;
  }

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
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
            {view.pilot === 'golden' ? 'Golden Journey pilot' : 'All Tools'}
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
          {view.pilot !== 'golden' && (
            <Link
              className="mt-3 inline-flex rounded-md border bg-white px-3 py-2 text-sm font-medium shadow-xs hover:bg-slate-50"
              href="/internal/tools/?pilot=golden"
            >
              Open Golden Journey pilot
            </Link>
          )}
        </header>

        {view.pilot === 'golden' ? (
          <GoldenPilotPanel pilot={goldenPilot} />
        ) : (
          <ToolExpansionPlanner
            plan={expansionPlan}
            activeGroupId={view.expansionGroup || null}
            onSelect={(group) => {
              setSelected(null);
              commitView({
                ...DEFAULT_TOOL_FACTORY_VIEW,
                expansionGroup: group.id,
              });
            }}
          />
        )}

        {activeExpansionGroup && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
            <strong>
              Filtering to rank {activeExpansionGroup.rank} ·{' '}
              {activeExpansionGroup.operationFamily}
            </strong>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                commitView(DEFAULT_TOOL_FACTORY_VIEW);
              }}
            >
              Clear expansion filter
            </Button>
          </div>
        )}

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
              aria-label="Filter by current execution"
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              value={view.filters.currentExecution}
              onChange={(event) =>
                setFilter('currentExecution', event.target.value)
              }
            >
              <option value="">All current execution</option>
              {profileValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Filter by preferred target"
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              value={view.filters.preferredTarget}
              onChange={(event) =>
                setFilter('preferredTarget', event.target.value)
              }
            >
              <option value="">All preferred targets</option>
              {targetValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Filter by server dependency"
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              value={view.filters.serverDependency}
              onChange={(event) =>
                setFilter('serverDependency', event.target.value)
              }
            >
              <option value="">All server dependencies</option>
              {serverDependencyValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Filter by browser opportunity"
              className="h-9 max-w-56 rounded-md border bg-white px-3 text-sm"
              value={view.filters.browserFeasibility}
              onChange={(event) =>
                setFilter('browserFeasibility', event.target.value)
              }
            >
              <option value="">All browser opportunities</option>
              {browserFeasibilityValues.map((value) => (
                <option key={value} value={value}>
                  {browserOpportunityLabel(value)}
                </option>
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
      <ToolDetail
        row={selected}
        clientFirst={
          selected ? (clientFirstByToolId.get(selected.toolId) ?? null) : null
        }
        runtimeObservations={runtimeObservations}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}

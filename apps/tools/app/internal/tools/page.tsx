import { getD1ToolsDashboardData } from '@serp-tools/tool-telemetry/d1';
import { getSerpToolsD1Binding } from '@/lib/cloudflare-d1';
import {
  describeDashboardLoadError,
  joinToolEvidence,
  type DashboardLoadError,
} from '@/lib/internal-tools-dashboard';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type FailureSummary = {
  toolId: string;
  errorCode: string | null;
  count: number;
  lastSeen: Date | string | null;
  sampleMetadata: Record<string, unknown> | null;
};

type StatusRow = {
  toolId: string;
  status: string;
  lastRunAt: Date | string | null;
  failureRate24h: number | null;
  medianDurationMs: number | null;
  medianReductionPct: number | null;
  updatedAt: Date | string;
};

const MAX_METADATA_LENGTH = 240;

export default async function ToolsDashboard({ searchParams }: PageProps) {
  const token = process.env.INTERNAL_DASHBOARD_TOKEN;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const providedToken = Array.isArray(resolvedSearchParams?.token)
    ? resolvedSearchParams?.token[0]
    : resolvedSearchParams?.token;
  if (token && token !== providedToken) {
    return (
      <main className="min-h-screen p-8">
        <div className="max-w-3xl mx-auto border rounded-lg p-6">
          <h1 className="text-2xl font-semibold mb-2">Tools Dashboard</h1>
          <p className="text-sm text-muted-foreground">Unauthorized.</p>
        </div>
      </main>
    );
  }

  let rows: StatusRow[] = [];
  let failureRows: FailureSummary[] = [];
  let loadError: DashboardLoadError | null = null;

  try {
    const d1 = await getSerpToolsD1Binding();

    if (!d1) {
      throw new Error('D1 telemetry binding unavailable.');
    }
    const dashboardData = await getD1ToolsDashboardData(d1);
    rows = dashboardData.statusRows;
    failureRows = dashboardData.failureRows;
  } catch (err: unknown) {
    loadError = describeDashboardLoadError(err);
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Tools Dashboard</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Status and telemetry summary for tool runs (last 24h).
        </p>

        {loadError ? (
          <div className="border rounded-lg p-4" role="alert">
            <h2 className="font-medium mb-1">{loadError.title}</h2>
            <p className="text-sm text-muted-foreground">{loadError.message}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-3">Tool</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Last Run</th>
                    <th className="text-right p-3">Failure Rate</th>
                    <th className="text-right p-3">Median Duration</th>
                    <th className="text-right p-3">Median Reduction</th>
                  </tr>
                </thead>
                <tbody>
                  {joinToolEvidence(rows).map(({ tool, evidence: row }) => {
                    return (
                      <tr key={row.toolId} className="border-t">
                        <td className="p-3">
                          <div className="font-medium">
                            {tool?.name ?? row.toolId}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {tool?.route ?? '-'}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border">
                            {row.status}
                          </span>
                        </td>
                        <td className="p-3">
                          {row.lastRunAt
                            ? new Date(row.lastRunAt).toLocaleString()
                            : '-'}
                        </td>
                        <td className="p-3 text-right">
                          {row.failureRate24h !== null &&
                          row.failureRate24h !== undefined
                            ? `${Math.round(row.failureRate24h * 100)}%`
                            : '-'}
                        </td>
                        <td className="p-3 text-right">
                          {row.medianDurationMs
                            ? `${row.medianDurationMs} ms`
                            : '-'}
                        </td>
                        <td className="p-3 text-right">
                          {row.medianReductionPct !== null &&
                          row.medianReductionPct !== undefined
                            ? `${row.medianReductionPct}%`
                            : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-10">
              <h2 className="text-xl font-semibold mb-2">
                Top Failures (last 24h)
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                Aggregated by tool + error code. Sample metadata shows the
                latest failure payload.
              </p>
              {failureRows.length === 0 ? (
                <div className="border rounded-lg p-4 text-sm text-muted-foreground">
                  No failed runs recorded in the last 24h.
                </div>
              ) : (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left p-3">Tool</th>
                        <th className="text-left p-3">Error</th>
                        <th className="text-right p-3">Count</th>
                        <th className="text-left p-3">Last Seen</th>
                        <th className="text-left p-3">Sample Metadata</th>
                      </tr>
                    </thead>
                    <tbody>
                      {joinToolEvidence(failureRows).map(
                        ({ tool, evidence: row }) => {
                          const metadataText = row.sampleMetadata
                            ? JSON.stringify(row.sampleMetadata)
                            : '-';
                          const metadataPreview =
                            metadataText.length > MAX_METADATA_LENGTH
                              ? `${metadataText.slice(0, MAX_METADATA_LENGTH)}...`
                              : metadataText;

                          return (
                            <tr
                              key={`${row.toolId}-${row.errorCode ?? 'unknown'}`}
                              className="border-t"
                            >
                              <td className="p-3">
                                <div className="font-medium">
                                  {tool?.name ?? row.toolId}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {tool?.route ?? '-'}
                                </div>
                              </td>
                              <td className="p-3">
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border">
                                  {row.errorCode ?? 'unknown'}
                                </span>
                              </td>
                              <td className="p-3 text-right">{row.count}</td>
                              <td className="p-3">
                                {row.lastSeen
                                  ? new Date(row.lastSeen).toLocaleString()
                                  : '-'}
                              </td>
                              <td className="p-3 text-xs text-muted-foreground whitespace-pre-wrap break-words">
                                {metadataPreview}
                              </td>
                            </tr>
                          );
                        },
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

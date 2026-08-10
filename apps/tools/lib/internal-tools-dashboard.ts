import {
  toolCatalog,
  type ToolCatalog,
} from '@serp-tools/app-core/lib/tool-catalog';

type ToolEvidence = { toolId: string };

export type DashboardLoadError = Readonly<{
  title: string;
  message: string;
}>;

export function describeDashboardLoadError(error: unknown): DashboardLoadError {
  const detail = error instanceof Error ? error.message : String(error);

  if (/no such table\b/i.test(detail)) {
    return {
      title: 'Telemetry database is not initialized',
      message:
        'Apply the configured D1 migrations, then refresh this page. For local development, run pnpm migrate:d1:local.',
    };
  }

  return {
    title: 'Dashboard data is unavailable',
    message:
      'Verify the D1 binding and migration status, then refresh this page.',
  };
}

export function joinToolEvidence<Evidence extends ToolEvidence>(
  evidenceRows: readonly Evidence[],
  catalog: ToolCatalog = toolCatalog,
) {
  return evidenceRows.map((evidence) => {
    const catalogTool = catalog.getById(evidence.toolId);
    return {
      tool: catalogTool
        ? {
            id: catalogTool.id,
            name: catalogTool.name,
            route: catalogTool.route,
            isActive: catalogTool.isActive,
          }
        : null,
      evidence,
    };
  });
}

import {
  toolCatalog,
  type ToolCatalog,
} from '@serp-tools/app-core/lib/tool-catalog';

type ToolEvidence = { toolId: string };

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

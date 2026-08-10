import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

export type TableConvertPage = {
  slug: string;
  from: string;
  to: string;
  title: string;
};

export function getTableRendererToolIds(): readonly string[] {
  return toolCatalog.activeTools
    .filter((tool) => tool.content?.tool.renderer === 'table')
    .map((tool) => tool.id);
}

export function isTableRendererTool(toolId: string): boolean {
  return toolCatalog.getById(toolId)?.content?.tool.renderer === 'table';
}

export function getTableConvertPages(): readonly TableConvertPage[] {
  return Object.freeze(
    toolCatalog.activeTools.flatMap((tool) => {
      const content = toolCatalog.getPageContent(tool.id);
      if (
        tool.content?.tool.renderer !== 'table' ||
        !tool.content.tool.showInTableLinks ||
        !tool.from ||
        !tool.to ||
        !content
      ) {
        return [];
      }
      return [
        Object.freeze({
          slug: tool.id,
          from: tool.from,
          to: tool.to,
          title: content.tool.title,
        }),
      ];
    }),
  );
}

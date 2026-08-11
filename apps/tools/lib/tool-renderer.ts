import type { CatalogTool } from '@serp-tools/app-core/lib/tool-catalog';

import { isTableRendererTool } from './table-convert-pages.ts';

export type ToolRenderer =
  | 'table'
  | 'specialized'
  | 'generic'
  | 'downloader'
  | 'pdf'
  | 'placeholder'
  | 'not-found';

export function selectToolRenderer(tool: CatalogTool | undefined): ToolRenderer {
  if (!tool?.isActive) return 'not-found';
  if (isTableRendererTool(tool.id)) return 'table';
  if (
    ['json-to-csv', 'csv-combiner', 'html-to-markdown', 'character-counter'].includes(
      tool.id,
    )
  ) {
    return 'specialized';
  }
  if (
    (tool.operation === 'convert' || tool.operation === 'compress') &&
    tool.from &&
    tool.to
  ) {
    return 'generic';
  }
  if (tool.operation === 'download') return 'downloader';
  if (tool.operation === 'view' || tool.operation === 'edit') return 'pdf';
  if (
    tool.operation === 'video-editor' ||
    tool.operation === 'image-editor' ||
    tool.operation === 'audio-editor'
  ) {
    return 'placeholder';
  }
  return 'not-found';
}

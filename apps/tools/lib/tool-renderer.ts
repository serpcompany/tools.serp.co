import type { CatalogTool } from '@serp-tools/app-core/lib/tool-catalog';

import { isTableRendererTool } from './table-convert-pages.ts';
import { getSpecializedPresentationRenderer } from './specialized-tool-policy.ts';

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
  const specializedRenderer = getSpecializedPresentationRenderer(tool);
  if (specializedRenderer) return specializedRenderer;
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

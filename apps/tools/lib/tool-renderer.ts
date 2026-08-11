import type { CatalogTool } from '@serp-tools/app-core/lib/tool-catalog';

import { isTranscriptionToolId } from './media-workflow/tool-family.ts';
import { isTableRendererTool } from './table-convert-pages.ts';

export type ToolRenderer =
  | 'table'
  | 'transcription'
  | 'generic'
  | 'downloader'
  | 'pdf'
  | 'placeholder'
  | 'not-found';

export function selectToolRenderer(
  tool: CatalogTool | undefined,
): ToolRenderer {
  if (!tool?.isActive) return 'not-found';
  if (isTableRendererTool(tool.id)) return 'table';
  if (isTranscriptionToolId(tool.id)) return 'transcription';
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

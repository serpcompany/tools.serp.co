import { notFound } from 'next/navigation';

import DownloaderPageTemplate from '@/components/DownloaderPageTemplate';
import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

type DownloaderPageRendererProps = {
  toolId: string;
};

export function DownloaderPageRenderer({
  toolId,
}: DownloaderPageRendererProps) {
  const tool = toolCatalog.getById(toolId);
  const content = toolCatalog.getPageContent(toolId);

  if (!tool?.isActive || tool.operation !== 'download' || !content) {
    return notFound();
  }

  return <DownloaderPageTemplate toolId={toolId} content={content} />;
}

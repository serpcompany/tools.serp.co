import { notFound, redirect } from 'next/navigation';

import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';
import { DownloaderPageRenderer } from '@/components/DownloaderPageRenderer';
import PdfToolPage from '@/components/PdfToolPage';
import ToolPlaceholder from '@/components/ToolPlaceholder';
import { ToolPageRenderer } from '@/components/ToolPageRenderer';
import { buildToolMetadata } from '@/lib/metadata';
import { selectToolRenderer } from '@/lib/tool-renderer';

const LEGACY_DOWNLOADER_ROUTE_REDIRECTS: Record<string, string> = {
  'download-kajab-videos': '/download-kajabi-videos',
  'download-stripcha-videos': '/download-stripchat-videos',
};

type PageProps = {
  params: Promise<{ tool: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { tool: toolId } = await params;
  return buildToolMetadata(toolId);
}

export default async function Page({ params }: PageProps) {
  const { tool: toolId } = await params;
  const legacyDownloaderRoute = LEGACY_DOWNLOADER_ROUTE_REDIRECTS[toolId];

  if (legacyDownloaderRoute) redirect(legacyDownloaderRoute);

  const tool = toolCatalog.getById(toolId);
  const renderer = selectToolRenderer(tool);

  if (renderer === 'generic') return <ToolPageRenderer toolId={toolId} />;
  if (renderer === 'downloader') {
    return <DownloaderPageRenderer toolId={toolId} />;
  }
  if (renderer === 'pdf') return <PdfToolPage toolId={toolId} />;
  if (renderer === 'placeholder' && tool) {
    return <ToolPlaceholder title={tool.name} />;
  }
  return notFound();
}

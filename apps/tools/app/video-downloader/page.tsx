import DownloaderPageTemplate from '@/components/DownloaderPageTemplate';
import { buildToolMetadata } from '@/lib/metadata';
import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

const toolId = 'video-downloader';

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  const content = toolCatalog.getPageContent(toolId);

  if (!content) {
    return <div>Tool not found</div>;
  }

  return <DownloaderPageTemplate toolId={toolId} content={content} />;
}

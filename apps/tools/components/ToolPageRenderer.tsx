import { notFound } from 'next/navigation';

import ToolPageTemplate from '@/components/ToolPageTemplate';
import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

type ToolPageRendererProps = {
  toolId: string;
};

export function ToolPageRenderer({ toolId }: ToolPageRendererProps) {
  const tool = toolCatalog.getById(toolId);
  const content = toolCatalog.getPageContent(toolId);

  if (!tool?.isActive || !tool.from || !tool.to || !content) {
    return notFound();
  }

  const relatedItems = toolCatalog.getRelatedItems({
    currentFrom: content.tool.from,
    currentTo: content.tool.to,
    currentRoute: content.tool.route,
    currentToolId: content.tool.id,
    relatedTools: content.relatedTools,
  });

  return (
    <ToolPageTemplate
      tool={content.tool}
      videoSection={content.videoSection}
      howTo={content.howTo}
      infoArticle={content.infoArticle}
      faqs={content.faqs}
      aboutSection={content.aboutSection}
      changelog={content.changelog}
      resolvedRelatedItems={relatedItems}
      blogPosts={content.blogPosts}
    />
  );
}

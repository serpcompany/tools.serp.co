import { notFound } from 'next/navigation';

import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';
import PdfTool from '@/components/PdfTool';
import { BlogSection } from '@/components/sections/BlogSection';
import { ChangelogSection } from '@/components/sections/ChangelogSection';
import { FAQSection } from '@/components/sections/FAQSection';
import { HowToSection } from '@/components/sections/HowToSection';
import { InfoArticleSection } from '@/components/sections/InfoArticleSection';
import { ToolsLinkHub } from '@/components/sections/ToolsLinkHub';

type PdfToolPageProps = {
  toolId: string;
};

export default function PdfToolPage({ toolId }: PdfToolPageProps) {
  const tool = toolCatalog.getById(toolId);
  const content = toolCatalog.getPageContent(toolId);

  if (!tool?.isActive || !content) {
    return notFound();
  }

  const mode = tool.operation === 'edit' ? 'edit' : 'view';

  return (
    <main className="min-h-screen bg-background">
      <PdfTool
        toolId={toolId}
        title={content.tool.title}
        subtitle={content.tool.subtitle}
        mode={mode}
      />

      {content.howTo && (
        <HowToSection
          title={content.howTo.title}
          intro={content.howTo.intro}
          steps={content.howTo.steps}
        />
      )}

      {content.infoArticle && (
        <InfoArticleSection
          title={content.infoArticle.title}
          markdown={content.infoArticle.markdown}
        />
      )}

      {content.faqs && <FAQSection faqs={content.faqs} />}

      {content.blogPosts && <BlogSection blogPosts={content.blogPosts} />}

      {content.changelog && <ChangelogSection changelog={content.changelog} />}

      <ToolsLinkHub relatedTools={content.relatedTools} />
    </main>
  );
}

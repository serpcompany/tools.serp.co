import JsonToCsv from "@/components/JsonToCsv";
import { StructuredData } from "@/components/StructuredData";
import { FAQSection } from "@/components/sections/FAQSection";
import { BlogSection } from "@/components/sections/BlogSection";
import { ChangelogSection } from "@/components/sections/ChangelogSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { TableConvertLinksSection } from "@/components/sections/TableConvertLinksSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { buildToolMetadata } from "@/lib/metadata";
import { toolContent } from '@/lib/tool-content';
import { getEnabledVideoEmbedId } from "@/lib/video-embeds";

const toolId = "json-to-csv";
// The H1 and the line under it.
const title = "JSON to CSV Converter";
const subtitle = "Convert JSON data to CSV format for spreadsheets and data analysis";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  const content = toolContent[toolId];

  if (!content) {
    return <div>Tool not found</div>;
  }
  const videoEmbedId = getEnabledVideoEmbedId({
    tool: content.tool,
    videoSection: content.videoSection,
  });

  return (
    <main className="min-h-screen bg-background">
      <StructuredData toolId={toolId} name={title} description={subtitle} />

      {/* Custom JSON to CSV Component */}
      <JsonToCsv toolId={toolId} title={title} subtitle={subtitle} videoEmbedId={videoEmbedId} />

      {content.howTo && (
        <HowToSection title={content.howTo.title} intro={content.howTo.intro} steps={content.howTo.steps} />
      )}

      <TableConvertLinksSection currentSlug="json-to-csv" />

      {content.infoArticle && (
        <InfoArticleSection
          title={content.infoArticle.title}
          markdown={content.infoArticle.markdown}
        />
      )}

      {/* FAQs Section */}
      {content.faqs && <FAQSection faqs={content.faqs} />}

      {/* Blog Articles Section */}
      {content.blogPosts && <BlogSection blogPosts={content.blogPosts} />}

      {/* Changelog Section */}
      {content.changelog && <ChangelogSection changelog={content.changelog} />}

      {/* Related Tools Link Hub */}
      <ToolsLinkHub relatedTools={content.relatedTools} />
    </main>
  );
}

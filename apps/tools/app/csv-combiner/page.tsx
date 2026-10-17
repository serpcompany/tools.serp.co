import CsvCombiner from "@/components/CsvCombiner";
import { StructuredData } from "@/components/StructuredData";
import { AboutFormatsSection } from "@/components/sections/AboutFormatsSection";
import { FAQSection } from "@/components/sections/FAQSection";
import { BlogSection } from "@/components/sections/BlogSection";
import { ChangelogSection } from "@/components/sections/ChangelogSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { buildToolMetadata } from "@/lib/metadata";
import { toolContent } from "@/lib/tool-content";
import { getEnabledVideoEmbedId } from "@/lib/video-embeds";

const toolId = "csv-combiner";
// The H1 and the line under it.
const title = "CSV Combiner";
const subtitle = "Merge multiple CSV files into one clean dataset without uploads.";

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

      <CsvCombiner toolId={content.tool.id} title={title} subtitle={subtitle} videoEmbedId={videoEmbedId} />

      {content.aboutSection && (
        <AboutFormatsSection
          fromFormat={content.aboutSection.fromFormat}
          toFormat={content.aboutSection.toFormat}
        />
      )}

      {content.howTo && (
        <HowToSection title={content.howTo.title} intro={content.howTo.intro} steps={content.howTo.steps} />
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

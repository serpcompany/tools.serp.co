import TranscribeTool from "@/components/TranscribeTool";
import { FAQSection } from "@/components/sections/FAQSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { buildToolMetadata, toolHeading } from "@/lib/metadata";
import { toolContent } from "@/lib/tool-content";

const toolId = "audio-to-transcript";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  const content = toolContent[toolId];

  if (!content) {
    return <div>Tool not found</div>;
  }

  return (
    <main className="min-h-screen bg-background">
      <TranscribeTool
        toolId={toolId}
        title={toolHeading(toolId)}
        subtitle={content.tool.subtitle}
      />

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

      <ToolsLinkHub relatedTools={content.relatedTools} />
    </main>
  );
}

import CharacterCounter from "@/components/CharacterCounter";
import { StructuredData } from "@/components/StructuredData";
import { FAQSection } from "@/components/sections/FAQSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { buildToolMetadata, toolHeading } from "@/lib/metadata";
import { toolContent } from '@/lib/tool-content';

const toolId = "character-counter";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  const content = toolContent[toolId];

  if (!content) {
    return <div>Tool not found</div>;
  }
  // The H1 and the line under it, which the structured data repeats.
  const heading = toolHeading(toolId);
  const subtitle = content.tool.subtitle;

  return (
    <main className="min-h-screen bg-background">
      <StructuredData toolId={toolId} name={heading} description={subtitle} />

      {/* Custom Character Counter Component */}
      <CharacterCounter heading={heading} subtitle={subtitle} />

      {/* Related Tools Section - Character counter doesn't have from/to formats */}

      {content.howTo && (
        <HowToSection title={content.howTo.title} intro={content.howTo.intro} steps={content.howTo.steps} />
      )}

      {content.infoArticle && (
        <InfoArticleSection
          title={content.infoArticle.title}
          markdown={content.infoArticle.markdown}
        />
      )}

      {/* FAQs Section */}
      {content.faqs && <FAQSection faqs={content.faqs} />}

      {/* All tools link hub */}
      <ToolsLinkHub />
    </main>
  );
}

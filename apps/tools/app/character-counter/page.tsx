import CharacterCounter from "@/components/CharacterCounter";
import { StructuredData } from "@/components/StructuredData";
import { FAQSection } from "@/components/sections/FAQSection";
import { BlogSection } from "@/components/sections/BlogSection";
import { ChangelogSection } from "@/components/sections/ChangelogSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { buildToolMetadata } from "@/lib/metadata";
import { toolContent } from '@/lib/tool-content';
import { getEnabledVideoEmbedId } from "@/lib/video-embeds";

const toolId = "character-counter";
// The H1 and the line under it.
const title = "Character Counter";
const subtitle = "Count characters, words, sentences, and paragraphs instantly";

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

      {/* Custom Character Counter Component */}
      <CharacterCounter title={title} subtitle={subtitle} videoEmbedId={videoEmbedId} />

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

      {/* Blog Articles Section */}
      {content.blogPosts && <BlogSection blogPosts={content.blogPosts} />}

      {/* Changelog Section */}
      {content.changelog && <ChangelogSection changelog={content.changelog} />}

      {/* All tools link hub */}
      <ToolsLinkHub />
    </main>
  );
}

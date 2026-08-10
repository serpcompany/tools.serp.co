import HtmlToMarkdownConverter from "@/components/HtmlToMarkdownConverter";
import { FAQSection } from "@/components/sections/FAQSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { buildToolMetadata } from "@/lib/metadata";
import { toolCatalog } from "@serp-tools/app-core/lib/tool-catalog";
import { notFound } from "next/navigation";

const toolId = "html-to-markdown";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  const content = toolCatalog.getPageContent(toolId);
  if (!content) return notFound();

  return (
    <main className="min-h-screen bg-background">
      <HtmlToMarkdownConverter />

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

      <ToolsLinkHub />
    </main>
  );
}

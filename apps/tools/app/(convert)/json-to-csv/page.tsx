import JsonToCsv from "@/components/JsonToCsv";
import { FAQSection } from "@/components/sections/FAQSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { TableConvertLinksSection } from "@/components/sections/TableConvertLinksSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { buildToolMetadata, toolHeading } from "@/lib/metadata";
import { toolContent } from '@/lib/tool-content';

const toolId = "json-to-csv";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  const content = toolContent[toolId];

  if (!content) {
    return <div>Tool not found</div>;
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Custom JSON to CSV Component */}
      <JsonToCsv
        toolId={toolId}
        heading={toolHeading(toolId)}
        subtitle={content.tool.subtitle}
       
      />

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

      {/* Related Tools Link Hub */}
      <ToolsLinkHub relatedTools={content.relatedTools} />
    </main>
  );
}

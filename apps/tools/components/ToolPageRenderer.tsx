import { notFound } from "next/navigation";

import ToolPageTemplate from "@/components/ToolPageTemplate";
import { getTool } from "@/lib/catalog/catalog";
import { toolSeo } from "@/lib/metadata";
import { toolContent } from "@/lib/tool-content";
import {
  buildConverterFaqs,
  buildHowToSection,
  buildInfoArticleSection,
  converterAccept,
} from "@/lib/tool-sections";
import type { InfoArticleSectionData, PairNotes, ToolContent, ToolInfo } from "@/types";

type ToolPageRendererProps = {
  toolId: string;
};

// A pair's notes, in the place of the template article.
const pairNotesArticle = ({ title, points }: PairNotes): InfoArticleSectionData => ({
  title,
  markdown: points.map((point) => `- ${point}`).join("\n"),
});

// The converter and compressor page: curated content where the registry has
// it, else the template sections of lib/tool-sections.ts. The H1 is the
// Tool's SEO heading (lib/metadata.ts). It has no changelog or blog list:
// those were invented (#356).
export function ToolPageRenderer({ toolId }: ToolPageRendererProps) {
  const tool = getTool(toolId);

  if (!tool || !tool.from || !tool.to) {
    return notFound();
  }

  const content: ToolContent | undefined = toolContent[toolId];
  const seo = toolSeo(tool);
  // Curated content keeps its own file filter, none included.
  const toolInfo: ToolInfo = content
    ? { ...content.tool, title: seo.h1 }
    : {
        id: tool.id,
        route: tool.route,
        operation: tool.operation,
        title: seo.h1,
        subtitle: tool.description,
        from: tool.from,
        to: tool.to,
        accept: converterAccept(tool.from),
        requiresFFmpeg: tool.requiresFFmpeg,
      };
  const pairNotes = content?.pairNotes;

  return (
    <ToolPageTemplate
      tool={toolInfo}
      video={tool.video}
      howTo={content?.howTo ?? buildHowToSection(tool)}
      infoArticle={
        pairNotes ? pairNotesArticle(pairNotes) : (content?.infoArticle ?? buildInfoArticleSection(tool))
      }
      guide={content?.guide}
      faqs={content ? content.faqs : buildConverterFaqs(tool)}
      aboutSection={content?.aboutSection}
      relatedTools={content?.relatedTools}
    />
  );
}

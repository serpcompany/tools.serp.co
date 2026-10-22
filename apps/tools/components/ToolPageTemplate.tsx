import HeroConverter from "@/components/HeroConverter";
import ImagesToPdfConverter from "@/components/ImagesToPdfConverter";
import { StructuredData } from "@/components/StructuredData";
import { AboutFormatsSection } from "@/components/sections/AboutFormatsSection";
import { FAQSection } from "@/components/sections/FAQSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { RelatedToolsSection } from "@/components/sections/RelatedToolsSection";
import { RelatedAppsSection } from "@/components/sections/RelatedAppsSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { ToolVideoSection } from "@/components/sections/ToolVideoSection";
import { videoOnlyNote } from "@/lib/convert/webcodecs";
import { shownToolVideo } from "@/lib/tool-video";
import type {
  ToolInfo,
  ToolVideo,
  FAQ,
  AboutFormatsSection as AboutFormatsSectionData,
  RelatedTool,
  HowToSectionData,
  InfoArticleSectionData
} from "@/types";

type ToolPageProps = {
  tool: ToolInfo;
  // The Tool's how-to video (the registry's `video`).
  video?: ToolVideo;
  faqs?: FAQ[];
  aboutSection?: AboutFormatsSectionData;
  howTo?: HowToSectionData;
  infoArticle?: InfoArticleSectionData;
  relatedTools?: RelatedTool[];
};

// Converter and compressor pages show no changelog or blog list: theirs were
// invented (#356). A Server Component: it holds no state, and RelatedToolsSection and
// ToolsLinkHub read the catalog, which must stay out of the browser bundle.
// The converter heroes, FAQs and video player are client components of their
// own. A how-to video shows under the guide and links to its watch page,
// whose JSON-LD describes it: this page's describes only the Tool.
export default function ToolPageTemplate({
  tool,
  video,
  faqs,
  aboutSection,
  howTo,
  infoArticle,
  relatedTools,
}: ToolPageProps) {
  const shownVideo = shownToolVideo(tool, video);
  const currentRoute =
    tool.route ??
    (tool.from && tool.to ? `/${tool.from.toLowerCase()}-to-${tool.to.toLowerCase()}` : undefined);
  const note = videoOnlyNote(tool.from, tool.to);
  const showRelatedTools = Boolean(
    (relatedTools && relatedTools.length > 0) || (tool.from && tool.to)
  );

  return (
    <main className="min-h-screen bg-background">
      <StructuredData toolId={tool.id} name={tool.title} description={tool.subtitle} />

      {/* Image to PDF takes any image, and combines several into one PDF. */}
      {tool.from === "image" && tool.to === "pdf" ? (
        <ImagesToPdfConverter
          toolId={tool.id}
          title={tool.title}
          subtitle={tool.subtitle}
          note={note}
          from={tool.from}
          to={tool.to}
        />
      ) : (
        <HeroConverter
          toolId={tool.id}
          title={tool.title}
          subtitle={tool.subtitle}
          note={note}
          from={tool.from}
          to={tool.to}
          accept={tool.accept}
          operation={tool.operation}
        />
      )}
      {shownVideo && tool.id && <ToolVideoSection toolId={tool.id} video={shownVideo} />}
      {/* About the Formats Section - Right after the hero */}
      {aboutSection && (
        <AboutFormatsSection
          fromFormat={aboutSection.fromFormat}
          toFormat={aboutSection.toFormat}
        />
      )}
      {howTo && <HowToSection title={howTo.title} intro={howTo.intro} steps={howTo.steps} />}

      {/* Related Tools Section - right after format cards */}
      {showRelatedTools && (
        <RelatedToolsSection
          currentFrom={tool.from}
          currentTo={tool.to}
          currentRoute={currentRoute}
          currentToolId={tool.id}
          relatedTools={relatedTools}
        />
      )}

      {/* Related Apps Section */}
      {tool.from && tool.to && (
        <RelatedAppsSection
          currentFrom={tool.from}
          currentTo={tool.to}
        />
      )}

      {infoArticle && (
        <InfoArticleSection
          title={infoArticle.title}
          markdown={infoArticle.markdown}
        />
      )}

      {/* FAQs Section */}
      {faqs && <FAQSection faqs={faqs} />}

      {/* All tools link hub */}
      <ToolsLinkHub />
    </main>
  );
}

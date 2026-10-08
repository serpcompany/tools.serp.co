import HeroConverter from "@/components/HeroConverter";
import LanderHeroTwoColumn from "@/components/LanderHeroTwoColumn";
import { AboutFormatsSection } from "@/components/sections/AboutFormatsSection";
import { FAQSection } from "@/components/sections/FAQSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { BlogSection } from "@/components/sections/BlogSection";
import { ChangelogSection } from "@/components/sections/ChangelogSection";
import { RelatedToolsSection } from "@/components/sections/RelatedToolsSection";
import { RelatedAppsSection } from "@/components/sections/RelatedAppsSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { getEnabledVideoEmbedId } from "@/lib/video-embeds";
import type {
  ToolInfo,
  VideoSectionData,
  FAQ,
  AboutFormatsSection as AboutFormatsSectionData,
  ChangelogEntry,
  RelatedTool,
  BlogPost,
  HowToSectionData,
  InfoArticleSectionData
} from "@/types";

type ToolPageProps = {
  tool: ToolInfo;
  videoSection?: VideoSectionData;
  useTwoColumnLayout?: boolean;
  faqs?: FAQ[];
  aboutSection?: AboutFormatsSectionData;
  howTo?: HowToSectionData;
  infoArticle?: InfoArticleSectionData;
  changelog?: ChangelogEntry[];
  relatedTools?: RelatedTool[];
  blogPosts?: BlogPost[];
};

// A Server Component: it holds no state, and RelatedToolsSection and
// ToolsLinkHub read the catalog, which must stay out of the browser bundle.
// The converter heroes and FAQs are client components of their own.
export default function ToolPageTemplate({
  tool,
  videoSection,
  useTwoColumnLayout = true, // Default to true for two-column layout
  faqs,
  aboutSection,
  howTo,
  infoArticle,
  changelog,
  relatedTools,
  blogPosts,
}: ToolPageProps) {
  const videoEmbedId = getEnabledVideoEmbedId({ tool, videoSection });
  const shouldUseTwoColumn = Boolean(useTwoColumnLayout && videoEmbedId);
  const currentRoute =
    tool.route ??
    (tool.from && tool.to ? `/${tool.from.toLowerCase()}-to-${tool.to.toLowerCase()}` : undefined);
  const showRelatedTools = Boolean(
    (relatedTools && relatedTools.length > 0) || (tool.from && tool.to)
  );

  return (
    <main className="min-h-screen bg-background">
      {/* Hero Section with Tool */}
      {shouldUseTwoColumn ? (
        <>
          <LanderHeroTwoColumn
            toolId={tool.id}
            title={tool.title}
            subtitle={tool.subtitle}
            from={tool.from}
            to={tool.to}
            accept={tool.accept}
            operation={tool.operation}
            videoEmbedId={videoEmbedId}
          />
          {/* About the Formats Section - Right after 2-column hero */}
          {aboutSection && (
            <AboutFormatsSection
              fromFormat={aboutSection.fromFormat}
              toFormat={aboutSection.toFormat}
            />
          )}
          {howTo && <HowToSection title={howTo.title} intro={howTo.intro} steps={howTo.steps} />}
        </>
      ) : (
        <>
          <HeroConverter
            toolId={tool.id}
            title={tool.title}
            subtitle={tool.subtitle}
            from={tool.from}
            to={tool.to}
            accept={tool.accept}
            operation={tool.operation}
          />
          {/* About the Formats Section - Right after regular hero */}
          {aboutSection && (
            <AboutFormatsSection
              fromFormat={aboutSection.fromFormat}
              toFormat={aboutSection.toFormat}
            />
          )}
          {howTo && <HowToSection title={howTo.title} intro={howTo.intro} steps={howTo.steps} />}
        </>
      )}

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

      {/* Blog Articles Section */}
      {blogPosts && <BlogSection blogPosts={blogPosts} />}

      {/* Changelog Section */}
      {changelog && <ChangelogSection changelog={changelog} />}

      {/* All tools link hub */}
      <ToolsLinkHub />
    </main>
  );
}

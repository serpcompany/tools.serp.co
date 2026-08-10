'use client';

import HeroConverter from '@/components/HeroConverter';
import LanderHeroTwoColumn from '@/components/LanderHeroTwoColumn';
import { AboutFormatsSection } from '@/components/sections/AboutFormatsSection';
import { FAQSection } from '@/components/sections/FAQSection';
import { ToolsLinkHub } from '@/components/sections/ToolsLinkHub';
import { BlogSection } from '@/components/sections/BlogSection';
import { ChangelogSection } from '@/components/sections/ChangelogSection';
import { RelatedItemsSection } from '@/components/sections/RelatedItemsSection';
import { RelatedAppsSection } from '@/components/sections/RelatedAppsSection';
import { HowToSection } from '@/components/sections/HowToSection';
import { InfoArticleSection } from '@/components/sections/InfoArticleSection';
import { getEnabledVideoEmbedId } from '@/lib/video-embeds';
import type {
  CatalogPageContent,
  CatalogRelatedItem,
} from '@serp-tools/app-core/lib/tool-catalog';

type ToolPageProps = {
  tool: CatalogPageContent['tool'];
  videoSection?: CatalogPageContent['videoSection'];
  useTwoColumnLayout?: boolean;
  faqs?: CatalogPageContent['faqs'];
  aboutSection?: CatalogPageContent['aboutSection'];
  howTo?: CatalogPageContent['howTo'];
  infoArticle?: CatalogPageContent['infoArticle'];
  changelog?: CatalogPageContent['changelog'];
  resolvedRelatedItems?: readonly CatalogRelatedItem[];
  blogPosts?: CatalogPageContent['blogPosts'];
};

export default function ToolPageTemplate({
  tool,
  videoSection,
  useTwoColumnLayout = true, // Default to true for two-column layout
  faqs,
  aboutSection,
  howTo,
  infoArticle,
  changelog,
  resolvedRelatedItems = [],
  blogPosts,
}: ToolPageProps) {
  const videoEmbedId = getEnabledVideoEmbedId({ tool, videoSection });
  const shouldUseTwoColumn = Boolean(useTwoColumnLayout && videoEmbedId);
  const showRelatedItems = Boolean(resolvedRelatedItems.length > 0);

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
          {howTo && (
            <HowToSection
              title={howTo.title}
              intro={howTo.intro}
              steps={howTo.steps}
            />
          )}
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
          {howTo && (
            <HowToSection
              title={howTo.title}
              intro={howTo.intro}
              steps={howTo.steps}
            />
          )}
        </>
      )}

      {/* Related Tools Section - right after format cards */}
      {showRelatedItems && <RelatedItemsSection items={resolvedRelatedItems} />}

      {/* Related Apps Section */}
      {tool.from && tool.to && (
        <RelatedAppsSection currentFrom={tool.from} currentTo={tool.to} />
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

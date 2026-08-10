import DownloaderExtensionCTA from '@/components/DownloaderExtensionCTA';
import DownloaderPageHero from '@/components/DownloaderPageHero';
import { FAQSection } from '@/components/sections/FAQSection';
import { BlogSection } from '@/components/sections/BlogSection';
import { ChangelogSection } from '@/components/sections/ChangelogSection';
import { HowToSection } from '@/components/sections/HowToSection';
import { InfoArticleSection } from '@/components/sections/InfoArticleSection';
import { ToolsLinkHub } from '@/components/sections/ToolsLinkHub';
import { withSerplyTracking } from '@/lib/downloader-extension-cta';
import type { CatalogPageContent } from '@serp-tools/app-core/lib/tool-catalog';

type DownloaderPageTemplateProps = {
  toolId: string;
  content: CatalogPageContent;
};

type OutboundLink = { label: string; url: string };

function getDownloaderOutboundLinks(
  content: CatalogPageContent,
): OutboundLink[] {
  const links: OutboundLink[] = [];

  if (content.productLinks?.serplyUrl) {
    links.push({
      label: 'Install browser extension',
      url: content.productLinks.serplyUrl,
    });
  }

  if (content.productLinks?.appsUrl) {
    links.push({ label: 'SERP Apps', url: content.productLinks.appsUrl });
  }

  if (content.productLinks?.githubRepoUrl) {
    links.push({
      label: 'GitHub repository',
      url: content.productLinks.githubRepoUrl,
    });
  }

  if (content.sourceLinks) {
    links.push(...content.sourceLinks);
  }

  return links.filter(
    (link, index, allLinks) =>
      allLinks.findIndex((candidate) => candidate.url === link.url) === index,
  );
}

export default function DownloaderPageTemplate({
  toolId,
  content,
}: DownloaderPageTemplateProps) {
  const outboundLinks = getDownloaderOutboundLinks(content);

  return (
    <main className="min-h-screen bg-background">
      <DownloaderExtensionCTA extensionUrl={content.productLinks?.serplyUrl} />

      <DownloaderPageHero
        toolId={toolId}
        title={content.tool.title}
        subtitle={content.tool.subtitle}
        extensionUrl={content.productLinks?.serplyUrl}
        extensionProductName={content.tool.title}
      />

      {content.howTo && (
        <HowToSection
          title={content.howTo.title}
          intro={content.howTo.intro}
          steps={content.howTo.steps}
        />
      )}

      {content.screenshots && content.screenshots.length > 0 && (
        <section className="bg-slate-50 py-16">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-8 max-w-3xl">
              <h2 className="text-3xl font-bold text-slate-950">Screenshots</h2>
              <p className="mt-3 text-base text-slate-600">
                Preview the extension experience before installing.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {content.screenshots.slice(0, 6).map((screenshot) => (
                <figure
                  key={screenshot.url}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshot.url}
                    alt={
                      screenshot.alt || screenshot.caption || content.tool.title
                    }
                    className="aspect-video h-full w-full object-cover"
                    loading="lazy"
                  />
                  {screenshot.caption && (
                    <figcaption className="px-4 py-3 text-sm text-slate-600">
                      {screenshot.caption}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {content.features && content.features.length > 0 && (
        <section className="bg-white py-16">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-8 max-w-3xl">
              <h2 className="text-3xl font-bold text-slate-950">Features</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {content.features.map((feature) => (
                <div
                  key={feature}
                  className="rounded-lg border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700"
                >
                  {feature}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {content.infoArticle && (
        <InfoArticleSection
          title={content.infoArticle.title}
          markdown={content.infoArticle.markdown}
        />
      )}

      {content.reviews && content.reviews.length > 0 && (
        <section className="bg-slate-50 py-16">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-8 max-w-3xl">
              <h2 className="text-3xl font-bold text-slate-950">Reviews</h2>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {content.reviews.map((review) => (
                <article
                  key={`${review.author}-${review.date ?? ''}`}
                  className="rounded-lg border border-slate-200 bg-white p-5"
                >
                  {review.rating && (
                    <p className="text-sm font-semibold text-[#0f62fe]">
                      {review.rating.toFixed(1)} / 5
                    </p>
                  )}
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    {review.body}
                  </p>
                  <p className="mt-4 text-sm font-semibold text-slate-950">
                    {review.author}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {outboundLinks.length > 0 && (
        <section className="bg-white py-16">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-8 max-w-3xl">
              <h2 className="text-3xl font-bold text-slate-950">
                Official Links
              </h2>
              <p className="mt-3 text-base text-slate-600">
                Open the extension, product page, source repository, and related
                downloader resources.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {outboundLinks.map((link) => (
                <a
                  key={link.url}
                  href={withSerplyTracking(link.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex min-h-24 flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 transition-colors hover:border-[#0f62fe] hover:bg-[#f7faff]"
                >
                  <span className="text-base font-semibold text-[#0f62fe] group-hover:text-[#0b4ccc]">
                    {link.label}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {(content.supportedOperatingSystems?.length ||
        content.supportedRegions?.length) && (
        <section className="bg-slate-50 py-16">
          <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-2">
            {content.supportedOperatingSystems &&
              content.supportedOperatingSystems.length > 0 && (
                <div>
                  <h2 className="text-2xl font-bold text-slate-950">
                    Supported Platforms
                  </h2>
                  <p className="mt-4 text-sm leading-6 text-slate-700">
                    {content.supportedOperatingSystems.join(', ')}
                  </p>
                </div>
              )}
            {content.supportedRegions &&
              content.supportedRegions.length > 0 && (
                <div>
                  <h2 className="text-2xl font-bold text-slate-950">
                    Supported Regions
                  </h2>
                  <p className="mt-4 text-sm leading-6 text-slate-700">
                    {content.supportedRegions.join(', ')}
                  </p>
                </div>
              )}
          </div>
        </section>
      )}

      {content.permissionJustifications &&
        content.permissionJustifications.length > 0 && (
          <section className="bg-slate-50 py-16">
            <div className="mx-auto max-w-7xl px-6">
              <h2 className="text-3xl font-bold text-slate-950">Permissions</h2>
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                {content.permissionJustifications.map((permission) => (
                  <div
                    key={permission.permission}
                    className="rounded-lg border border-slate-200 bg-white p-5"
                  >
                    <h3 className="text-base font-semibold text-slate-950">
                      {permission.permission}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {permission.justification}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

      {content.faqs && <FAQSection faqs={content.faqs} />}

      {content.blogPosts && <BlogSection blogPosts={content.blogPosts} />}

      {content.changelog && <ChangelogSection changelog={content.changelog} />}

      <ToolsLinkHub relatedTools={content.relatedTools} />
    </main>
  );
}

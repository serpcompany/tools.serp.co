import Link from "next/link";

import { HomeToolDirectory } from "@/components/HomeToolDirectory";
import { ToolCard } from "@/components/ToolCard";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { directoryCategories, homeCategorySections } from "@/lib/catalog/directory";

// The homepage canonical and og:url are the bare origin, with no trailing
// slash (serp url-trailing-slash standard). They're rendered here, not via
// metadata, because trailingSlash makes Next.js append a slash to both.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tools.serp.co";
const siteOrigin = (siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`).replace(/\/+$/, "");

// A Server Component: it reads the directory from the catalog and renders a
// few Tools per category, with a link to each category's pages. The search
// fetches the full Tool index only when someone uses it, so the registry and
// the full list never ship in the page.
export default function HomePage() {
  const sections = homeCategorySections();
  const categories = [
    { id: "all", name: "Filter", count: sections.reduce((sum, section) => sum + section.count, 0) },
    ...directoryCategories().map((category) => ({
      id: category.id,
      name: category.name,
      count: category.count,
    })),
  ];

  return (
    <main className="min-h-screen">
      <link rel="canonical" href={siteOrigin} />
      <meta property="og:url" content={siteOrigin} />
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 bg-grid-black/[0.02] dark:bg-grid-white/[0.02]" />
        <div className="container relative py-16 md:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              SERP Tools
            </h1>
          </div>
        </div>
      </section>

      {/* Main Content: search and filter, then a few Tools per category */}
      <HomeToolDirectory categories={categories}>
        <div className="space-y-12">
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={`home-${section.id}`}>
              <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id={`home-${section.id}`} className="text-2xl font-semibold tracking-tight">
                  {section.title}
                </h2>
                <Link
                  href={section.href}
                  prefetch={false}
                  className="text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline"
                >
                  {section.count > section.tools.length
                    ? `View all ${section.count} tools`
                    : `View ${section.name} category`}
                </Link>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {section.tools.map((tool) => (
                  <ToolCard key={tool.href} tool={tool} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </HomeToolDirectory>

      {/* All tools link hub */}
      <ToolsLinkHub />
    </main>
  );
}

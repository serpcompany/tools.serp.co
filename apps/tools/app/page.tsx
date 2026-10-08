import { HomeToolDirectory } from "@/components/HomeToolDirectory";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { directoryCategories, directoryEntries } from "@/lib/catalog/directory";

// The homepage canonical and og:url are the bare origin, with no trailing
// slash (serp url-trailing-slash standard). They're rendered here, not via
// metadata, because trailingSlash makes Next.js append a slash to both.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tools.serp.co";
const siteOrigin = (siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`).replace(/\/+$/, "");

// A Server Component: it reads the directory from the catalog and hands the
// search grid plain data, so the registry never ships to the browser.
export default function HomePage() {
  const tools = directoryEntries();
  const categories = [
    { id: "all", name: "Filter", count: tools.length },
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

      {/* Main Content: search, filter and the Tool grid */}
      <HomeToolDirectory tools={tools} categories={categories} />

      {/* All tools link hub */}
      <ToolsLinkHub />
    </main>
  );
}

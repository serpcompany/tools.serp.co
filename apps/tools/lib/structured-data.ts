import { getTool } from "./catalog/catalog.ts";
import { categoryHref } from "./catalog/href.ts";
import { CATEGORY_CONTENT, isToolOperation } from "./catalog/operations.ts";
import { toSitemapUrl } from "./sitemap.ts";

// The JSON-LD a Tool page or Lander describes itself with (issue #324): a
// WebApplication for the Tool on the page and a BreadcrumbList from the
// homepage through the Tool's category to the page. StructuredData.tsx
// renders it; it reads the registry, so only Server Components import it.
//
// It claims only what the page backs: the Tool is free and runs in a browser.
// No Review, AggregateRating, FAQPage or HowTo: Lander reviews have no
// verifiable source, FAQ rich results are limited to government and health
// sites, and HowTo rich results are retired.

// The homepage's title and H1.
export const SITE_NAME = "SERP Tools";

// The origin every canonical URL is written on. It matches the metadataBase
// that app/layout.tsx resolves canonicals against, so a URL here equals the
// page's <link rel="canonical">. Pass process.env.NEXT_PUBLIC_SITE_URL, which
// the build inlines.
export function siteOrigin(siteUrl: string | undefined): string {
  const url = siteUrl ?? "https://tools.serp.co";
  return new URL(url.startsWith("http") ? url : `https://${url}`).origin;
}

// What the page shows: its H1 and the line under it.
export type ToolPageText = {
  toolId: string | undefined;
  name: string;
  description: string;
};

type ApplicationCategory = "MultimediaApplication" | "UtilitiesApplication";

type ListItem = {
  "@type": "ListItem";
  position: number;
  name: string;
  item: string;
};

export type ToolStructuredData = {
  "@context": "https://schema.org";
  "@graph": [
    {
      "@type": "WebApplication";
      name: string;
      url: string;
      description?: string;
      applicationCategory: ApplicationCategory;
      operatingSystem: "Any";
      offers: { "@type": "Offer"; price: "0"; priceCurrency: "USD" };
    },
    { "@type": "BreadcrumbList"; itemListElement: ListItem[] },
  ];
};

// Audio and video Tools (the registry marks each with requiresFFmpeg) and the
// downloaders, which save videos, are multimedia; the image, document, data
// and font Tools are utilities.
function applicationCategory(tool: {
  operation: string;
  requiresFFmpeg?: boolean;
}): ApplicationCategory {
  return tool.operation === "download" || tool.requiresFFmpeg
    ? "MultimediaApplication"
    : "UtilitiesApplication";
}

// The structured data for the active Tool `toolId`, or null when there is no
// such Tool. Every URL is absolute and canonical: the homepage is the bare
// origin and every other page ends in a slash.
export function toolStructuredData(
  { toolId, name, description }: ToolPageText,
  origin: string,
): ToolStructuredData | null {
  const tool = toolId ? getTool(toolId) : undefined;
  if (!tool) return null;

  const url = toSitemapUrl(origin, tool.route);
  const crumbs = [{ name: SITE_NAME, url: toSitemapUrl(origin, "/") }];
  if (isToolOperation(tool.operation)) {
    crumbs.push({
      name: CATEGORY_CONTENT[tool.operation].title,
      url: toSitemapUrl(origin, categoryHref(tool.operation)),
    });
  }
  crumbs.push({ name, url });

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name,
        url,
        ...(description ? { description } : {}),
        applicationCategory: applicationCategory(tool),
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: crumb.name,
          item: crumb.url,
        })),
      },
    ],
  };
}

// JSON for an inline <script type="application/ld+json">. HTML ends a script
// at the first "</script", and "<!--" changes how it is parsed, so every <, >
// and & is written as a JSON escape, as are U+2028 and U+2029. JSON.parse
// reads the same value back.
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

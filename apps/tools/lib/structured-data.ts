import { getTool } from "./catalog/catalog.ts";
import { getSiteOrigin } from "./site-environment.ts";
import { normalizePath } from "./sitemap.ts";

// The JSON-LD a Tool page or Lander describes itself with (issue #324): a
// WebApplication for the Tool on the page. StructuredData.tsx renders it; it
// reads the registry, so only Server Components import it.
//
// It claims only what the page backs: the Tool is free and runs in a browser.
// No Review, AggregateRating, FAQPage or HowTo: Lander reviews have no
// verifiable source, FAQ rich results are limited to government and health
// sites, and HowTo rich results are retired. No BreadcrumbList either: no
// page shows a breadcrumb trail, and markup must describe what readers see.

// The origin the JSON-LD's URL is written on: a deployed build's canonical
// origin, from getSiteOrigin as the sitemap's is. A static page has no
// request, so a local run uses the URL app/layout.tsx's metadataBase falls
// back to. Pass process.env.NEXT_PUBLIC_SITE_ENV and NEXT_PUBLIC_SITE_URL,
// which the build inlines.
export function structuredDataOrigin({
  siteEnv,
  siteUrl,
}: {
  siteEnv: string | undefined;
  siteUrl: string | undefined;
}): string {
  return getSiteOrigin({ requestUrl: siteUrl ?? "https://tools.serp.co", siteEnv, siteUrl });
}

// What the page shows: its H1 and the line under it.
export type ToolPageText = {
  toolId: string | undefined;
  name: string;
  description: string;
};

type ApplicationCategory = "MultimediaApplication" | "UtilitiesApplication";

export type ToolStructuredData = {
  "@context": "https://schema.org";
  "@type": "WebApplication";
  name: string;
  url: string;
  description?: string;
  applicationCategory: ApplicationCategory;
  operatingSystem: "Any";
  offers: { "@type": "Offer"; price: "0"; priceCurrency: "USD" };
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
// such Tool or it has no route. `url` is the page's canonical URL: the path
// lib/metadata.ts writes (normalizePath of the route), resolved on the origin
// as Next.js resolves it on metadataBase. structured-data.test.mjs checks it
// against buildToolMetadata itself.
export function toolStructuredData(
  { toolId, name, description }: ToolPageText,
  origin: string,
): ToolStructuredData | null {
  const tool = toolId ? getTool(toolId) : undefined;
  if (!tool?.route) return null;

  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name,
    url: new URL(normalizePath(tool.route), origin).href,
    ...(description ? { description } : {}),
    applicationCategory: applicationCategory(tool),
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
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

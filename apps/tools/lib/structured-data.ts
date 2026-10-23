import { getTool } from "./catalog/catalog.ts";
import { getSiteOrigin } from "./site-environment.ts";
import { normalizePath, toSitemapUrl } from "./sitemap.ts";
import type { Crumb, WatchVideo } from "./videos.ts";

// The JSON-LD a page describes itself with. A Tool page or Lander has a
// WebApplication for the Tool on the page (issue #324); StructuredData.tsx
// renders it, and it reads the registry, so only Server Components import
// it. A video's watch page has its VideoObject and BreadcrumbList, and the
// /videos/ library an ItemList of the videos (issue #374), per the SERP
// watch-pages standard.
//
// It claims only what the page backs: the Tool is free and runs in a browser.
// No Review, AggregateRating, FAQPage or HowTo: Lander reviews have no
// verifiable source, FAQ rich results are limited to government and health
// sites, and HowTo rich results are retired. Only a watch page has a
// BreadcrumbList, as only it shows a breadcrumb trail: markup must describe
// what readers see. A converter page that shows a video has no VideoObject:
// Google lists a video from the page where it is the main content, its watch
// page.

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

const SITE_PUBLISHER = "SERP Tools";

export type VideoObjectStructuredData = {
  "@context": "https://schema.org";
  "@type": "VideoObject";
  name: string;
  description: string;
  thumbnailUrl: string[];
  uploadDate: string;
  duration: string;
  embedUrl: string;
  url: string;
  mainEntityOfPage: string;
  isFamilyFriendly: true;
  requiresSubscription: false;
  publisher: { "@type": "Organization"; name: string; url: string };
  potentialAction: {
    "@type": "WatchAction";
    target: { "@type": "EntryPoint"; urlTemplate: string };
  };
};

// A video on its watch page, the page Google lists it from. The name and
// description are the page's H1 and the text under it. embedUrl is the player
// the page's iframe loads; there is no contentUrl, which is for a media file's
// bytes and never a YouTube or HTML page.
export function videoObjectStructuredData(
  video: WatchVideo,
  origin: string,
): VideoObjectStructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: video.description,
    thumbnailUrl: [video.thumbnailUrl],
    uploadDate: video.uploadDate,
    duration: video.duration,
    embedUrl: video.embedUrl,
    url: video.watchUrl,
    mainEntityOfPage: video.watchUrl,
    isFamilyFriendly: true,
    requiresSubscription: false,
    publisher: { "@type": "Organization", name: SITE_PUBLISHER, url: origin },
    potentialAction: {
      "@type": "WatchAction",
      target: { "@type": "EntryPoint", urlTemplate: video.watchUrl },
    },
  };
}

export type BreadcrumbListStructuredData = {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: { "@type": "ListItem"; position: number; name: string; item: string }[];
};

// The trail a page shows (watchBreadcrumbs in lib/videos.ts), each step at
// its canonical URL: the homepage is the bare origin.
export function breadcrumbListStructuredData(
  crumbs: readonly Crumb[],
  origin: string,
): BreadcrumbListStructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: toSitemapUrl(origin, crumb.path),
    })),
  };
}

export type VideoListStructuredData = {
  "@context": "https://schema.org";
  "@type": "ItemList";
  name: string;
  itemListElement: {
    "@type": "ListItem";
    position: number;
    url: string;
    item: {
      "@type": "VideoObject";
      name: string;
      description: string;
      url: string;
      embedUrl: string;
      thumbnailUrl: string;
      uploadDate: string;
      duration: string;
    };
  }[];
};

// The /videos/ library: one ListItem per card, in the page's order, each at
// its watch page.
export function videoListStructuredData(
  name: string,
  videos: readonly WatchVideo[],
): VideoListStructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListElement: videos.map((video, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: video.watchUrl,
      item: {
        "@type": "VideoObject",
        name: video.title,
        description: video.description,
        url: video.watchUrl,
        embedUrl: video.embedUrl,
        thumbnailUrl: video.thumbnailUrl,
        uploadDate: video.uploadDate,
        duration: video.duration,
      },
    })),
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

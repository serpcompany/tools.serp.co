import type { Metadata } from "next";

import type { Tool, ToolVideo } from "@/types";

import { activeTools, getTool } from "./catalog/catalog.ts";
import { toolSeo } from "./metadata.ts";
import { FREE, composeDescription, pageMetadata } from "./page-metadata.ts";
import { VIDEOS_PATH, normalizePath, toSitemapUrl } from "./sitemap.ts";
import {
  durationSeconds,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from "./youtube.ts";

// The how-to videos and their pages (issue #374), per the SERP watch-pages
// standard (serpcompany/serp docs/engineering/websites/pages/watch-pages/).
// Each video is stored once, as its Tool's `video` in the registry
// (ToolVideo); everything else about it is derived here. It reads the
// registry, so only Server Components and route handlers import it.
//
// - /watch/<tool id>/<video id>/: the video's own page, where it is the main
//   content, so Google can list it in video results (app/watch/).
// - /videos/: the library, a card per video linking to its watch page.
// - /sitemap-videos.xml: every video, beside its watch page (lib/sitemap.ts).
// - The Tool's converter page shows it too, loaded on a click, and links to
//   its watch page (components/sections/ToolVideoSection.tsx).

// A video as its pages, the JSON-LD and the video sitemap use it: the
// standard's WatchVideo, on a product catalog site, where the product is the
// Tool.
export type WatchVideo = {
  // The YouTube id.
  id: string;
  // Its segment in the watch URL: the YouTube id, which never changes.
  slug: string;
  title: string;
  // Plain text, shown on the watch page as written.
  description: string;
  // Its page on YouTube.
  sourceUrl: string;
  watchPath: string;
  watchUrl: string;
  // The player the watch page embeds: never the watch page, never YouTube's.
  embedUrl: string;
  thumbnailUrl: string;
  platform: "youtube";
  uploadDate: string;
  duration: string;
  durationSeconds: number;
  // The Tool the video shows: its id, its page's H1, and its page.
  productSlug: string;
  productName: string;
  productPath: string;
};

export { VIDEOS_PATH };

// How many other videos a watch page links to.
export const RELATED_VIDEOS_LIMIT = 6;

export function watchPath(toolId: string, videoId: string): string {
  return `/watch/${toolId}/${videoId}/`;
}

type ToolWithVideo = Tool & { video: ToolVideo; route: string };

const hasVideo = (tool: Tool): tool is ToolWithVideo => Boolean(tool.video && tool.route);

// `origin` is the site's, as a page's JSON-LD writes its URLs
// (structuredDataOrigin in lib/structured-data.ts).
export function toWatchVideo(tool: ToolWithVideo, origin: string): WatchVideo {
  const { video } = tool;
  const path = watchPath(tool.id, video.id);
  return {
    id: video.id,
    slug: video.id,
    title: video.title,
    description: video.description,
    sourceUrl: youtubeWatchUrl(video.id),
    watchPath: path,
    watchUrl: toSitemapUrl(origin, path),
    embedUrl: youtubeEmbedUrl(video.id),
    thumbnailUrl: youtubeThumbnailUrl(video.id),
    platform: "youtube",
    uploadDate: video.uploadDate,
    duration: video.duration,
    durationSeconds: durationSeconds(video.duration),
    productSlug: tool.id,
    productName: toolSeo(tool).h1,
    productPath: normalizePath(tool.route),
  };
}

const newestFirst = (a: WatchVideo, b: WatchVideo) =>
  Date.parse(b.uploadDate) - Date.parse(a.uploadDate) || a.productSlug.localeCompare(b.productSlug);

// Every active Tool's video, newest first: the library's order.
export function watchVideos(origin: string): WatchVideo[] {
  return activeTools()
    .filter(hasVideo)
    .map((tool) => toWatchVideo(tool, origin))
    .sort(newestFirst);
}

// The video a watch URL names, or undefined: the Tool must be active and the
// id its video's.
export function findWatchVideo(
  toolId: string,
  videoId: string,
  origin: string,
): WatchVideo | undefined {
  const tool = getTool(toolId);
  if (!tool || !hasVideo(tool) || tool.video.id !== videoId) return undefined;
  return toWatchVideo(tool, origin);
}

// The watch route's params, one per video.
export function watchPageParams(): { tool: string; video: string }[] {
  return activeTools()
    .filter(hasVideo)
    .map((tool) => ({ tool: tool.id, video: tool.video.id }));
}

// A watch page's other videos, from the library (watchVideos): those whose
// Tool shares a format with this video's Tool first, then the rest, each in
// the library's order.
export function relatedWatchVideos(
  video: WatchVideo,
  library: readonly WatchVideo[],
  limit = RELATED_VIDEOS_LIMIT,
): WatchVideo[] {
  const formatsOf = (toolId: string) => {
    const tool = getTool(toolId);
    return [tool?.from, tool?.to].filter((format) => format !== undefined);
  };
  const formats = new Set(formatsOf(video.productSlug));
  const sharesFormat = (other: WatchVideo) => formatsOf(other.productSlug).some((format) => formats.has(format));
  const others = library.filter((other) => other.watchPath !== video.watchPath);
  return [...others.filter(sharesFormat), ...others.filter((other) => !sharesFormat(other))].slice(
    0,
    limit,
  );
}

export type Crumb = { name: string; path: string };

// The watch page's breadcrumb trail, Home › Videos › Tool › video: the page
// shows it and its BreadcrumbList describes it, so the two always agree.
export function watchBreadcrumbs(video: WatchVideo): Crumb[] {
  return [
    { name: "Home", path: "/" },
    { name: "Videos", path: VIDEOS_PATH },
    { name: video.productName, path: video.productPath },
    { name: video.title, path: video.watchPath },
  ];
}

// "28-second", "3-minute": how long a video is, as a description says it.
export function lengthPhrase(seconds: number): string {
  return seconds < 60 ? `${seconds}-second` : `${Math.round(seconds / 60)}-minute`;
}

// A watch page's meta description: what the video is and which Tool it
// shows. The video's written description is on the page itself.
export function watchDescription(video: WatchVideo): string {
  return composeDescription(
    `Watch ${video.title}: a ${lengthPhrase(video.durationSeconds)} video showing how to use the ${video.productName} on SERP Tools.`,
    [FREE],
  );
}

// A watch page's metadata: titled as the video, as its H1 and VideoObject
// are, and canonical at its watch URL. og:type is video.other, and og:video
// the player the page embeds.
export function buildWatchMetadata(video: WatchVideo): Metadata {
  const metadata = pageMetadata({
    title: video.title,
    description: watchDescription(video),
    canonical: video.watchPath,
    image: "videos",
  });
  return {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      type: "video.other",
      videos: [{ url: video.embedUrl, type: "text/html" }],
    },
  };
}

export const VIDEOS_TITLE = "How-to Videos";

const VIDEOS_DESCRIPTION =
  "Short videos that show how to use SERP Tools' free converters and compressors, step by step. Each has its own page, with a link to the tool it shows.";

export function buildVideosMetadata(): Metadata {
  return pageMetadata({
    title: VIDEOS_TITLE,
    description: VIDEOS_DESCRIPTION,
    canonical: VIDEOS_PATH,
    image: "videos",
  });
}

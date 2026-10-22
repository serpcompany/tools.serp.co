import { categoryPageHrefs } from "./catalog/category-pages.ts";
import { operationsUsedBy } from "./catalog/operations.ts";

// The sitemap tree follows the serp sitemap standard
// (serpcompany/serp docs/engineering/websites/features/xml-sitemaps.md):
// /sitemap-index.xml lists root-level URL sets named by content group, such as
// /sitemap-tools.xml, and never another index. A group that passes the
// per-file URL limit continues in /sitemap-tools-2.xml, /sitemap-tools-3.xml.
//
// The how-to videos (lib/videos.ts) add /videos/ and their watch pages to the
// pages group, and /sitemap-videos.xml, after the groups: each watch page
// again, with its video, per the watch-pages standard (serpcompany/serp
// docs/engineering/websites/pages/watch-pages/video-sitemap.md). It is the
// one file whose URLs another file also lists.

export const SITEMAP_INDEX_PATH = "/sitemap-index.xml";

// The sitemaps.org limit for one URL set.
export const MAX_URLS_PER_SITEMAP = 50_000;

export const STATIC_PATHS = ["/", "/categories/", "/brands/"];

const SITEMAP_GROUPS = ["pages", "tools", "categories"] as const;
type SitemapGroup = (typeof SITEMAP_GROUPS)[number];

// The video library's page (app/videos/). It is here, not in lib/videos.ts,
// because that module reads the registry; lib/videos.ts re-exports it.
export const VIDEOS_PATH = "/videos/";

export type SitemapTool = {
  route?: string | null;
  isActive: boolean;
  operation: string;
};

// A video as the video sitemap lists it: the fields of lib/videos.ts's
// WatchVideo it needs.
export type SitemapVideo = {
  watchPath: string;
  title: string;
  description: string;
  // The player, never the watch page: <video:player_loc>.
  embedUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  uploadDate: string;
};

export type SitemapFile =
  | { group: SitemapGroup; path: string; paths: string[] }
  | { group: "videos"; path: string; videos: SitemapVideo[] };

export type SitemapResponse =
  | { type: "xml"; body: string }
  | { type: "redirect"; location: string }
  | { type: "not-found" };

export const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function normalizePath(path: string) {
  if (!path) return "/";
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  if (withSlash === "/") return "/";
  return withSlash.endsWith("/") ? withSlash : `${withSlash}/`;
}

// The canonical URL of a page. The homepage is the origin itself, written
// without a slash; every other page ends in a slash.
export function toSitemapUrl(origin: string, path: string) {
  const normalized = normalizePath(path);
  return normalized === "/" ? origin : `${origin}${normalized}`;
}

export function getToolPaths(tools: readonly SitemapTool[]) {
  return tools
    .filter((tool) => tool.isActive && tool.route)
    .map((tool) => normalizePath(tool.route as string));
}

// Every numbered page of every category with an active Tool
// (lib/catalog/category-pages.ts), page 1 first.
export function getCategoryPaths(tools: readonly SitemapTool[]) {
  return operationsUsedBy(tools)
    .flatMap((operation) => {
      const count = tools.filter((tool) => tool.isActive && tool.operation === operation).length;
      return categoryPageHrefs(operation, count);
    })
    .map(normalizePath);
}

function getGroupPaths(
  tools: readonly SitemapTool[],
  videos: readonly SitemapVideo[],
): Record<SitemapGroup, string[]> {
  const videoPages = videos.length > 0 ? [VIDEOS_PATH, ...videos.map((video) => video.watchPath)] : [];
  return {
    pages: [...STATIC_PATHS, ...videoPages].map(normalizePath),
    tools: getToolPaths(tools),
    categories: getCategoryPaths(tools),
  };
}

// Every URL-set file, in index order. A path appears once across the
// groups' files, in the first group that lists it; the videos file, last,
// lists the watch pages again with their videos. Empty groups get no file.
export function getSitemapFiles(
  tools: readonly SitemapTool[],
  maxUrls: number = MAX_URLS_PER_SITEMAP,
  videos: readonly SitemapVideo[] = [],
): SitemapFile[] {
  const groupPaths = getGroupPaths(tools, videos);
  const seen = new Set<string>();
  const files: SitemapFile[] = [];

  for (const group of SITEMAP_GROUPS) {
    const paths = groupPaths[group].filter((path) => {
      if (seen.has(path)) return false;
      seen.add(path);
      return true;
    });
    for (let offset = 0, part = 1; offset < paths.length; offset += maxUrls, part += 1) {
      files.push({
        group,
        path: part === 1 ? `/sitemap-${group}.xml` : `/sitemap-${group}-${part}.xml`,
        paths: paths.slice(offset, offset + maxUrls),
      });
    }
  }

  for (let offset = 0, part = 1; offset < videos.length; offset += maxUrls, part += 1) {
    files.push({
      group: "videos",
      path: part === 1 ? "/sitemap-videos.xml" : `/sitemap-videos-${part}.xml`,
      videos: videos.slice(offset, offset + maxUrls),
    });
  }

  return files;
}

export function buildSitemapIndexXml(origin: string, files: SitemapFile[]) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...files.map((file) => `<sitemap><loc>${escapeXml(`${origin}${file.path}`)}</loc></sitemap>`),
    `</sitemapindex>`,
  ].join("");
}

export function buildUrlsetXml(origin: string, paths: string[]) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...paths.map((path) => `<url><loc>${escapeXml(toSitemapUrl(origin, path))}</loc></url>`),
    `</urlset>`,
  ].join("");
}

const VIDEO_SITEMAP_NAMESPACE = "http://www.google.com/schemas/sitemap-video/1.1";

// One <video:video> per watch page, per Google's video sitemap: the player
// (player_loc, never content_loc: the site has no media file of its own) and
// the length in seconds.
function videoXml(video: SitemapVideo) {
  const tag = (name: string, value: string) => `<video:${name}>${escapeXml(value)}</video:${name}>`;
  return [
    `<video:video>`,
    tag("thumbnail_loc", video.thumbnailUrl),
    tag("title", video.title),
    tag("description", video.description),
    `<video:player_loc allow_embed="yes">${escapeXml(video.embedUrl)}</video:player_loc>`,
    tag("duration", String(video.durationSeconds)),
    tag("publication_date", video.uploadDate),
    tag("family_friendly", "yes"),
    tag("live", "no"),
    `</video:video>`,
  ].join("");
}

export function buildVideoUrlsetXml(origin: string, videos: readonly SitemapVideo[]) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="${VIDEO_SITEMAP_NAMESPACE}">`,
    ...videos.map(
      (video) => `<url><loc>${escapeXml(toSitemapUrl(origin, video.watchPath))}</loc>${videoXml(video)}</url>`,
    ),
    `</urlset>`,
  ].join("");
}

// Sitemap URLs published before the flat tree, which search engines may still
// request. Old indexes and the old combined /sitemap-N.xml point at the new
// index; an old group URL set points at the first file of that group.
const LEGACY_INDEX = /^(?:sitemap|(?:pages|tools|categories)-index|sitemap-\d+)\.xml$/;
const LEGACY_GROUP_FILE = /^(pages|tools|categories)-\d+\.xml$/;

function getLegacyRedirectPath(fileName: string, files: SitemapFile[]) {
  if (LEGACY_INDEX.test(fileName)) return SITEMAP_INDEX_PATH;
  const group = LEGACY_GROUP_FILE.exec(fileName)?.[1];
  if (!group) return null;
  return files.find((file) => file.group === group)?.path ?? SITEMAP_INDEX_PATH;
}

type ResolveOptions = {
  origin: string;
  tools: readonly SitemapTool[];
  // Every active Tool's video (watchVideos in lib/videos.ts); none by default.
  videos?: readonly SitemapVideo[];
  maxUrls?: number;
};

// What to answer for a root-level sitemap file name such as
// "sitemap-tools.xml": the XML, a 308 target for a retired name, or 404.
export function resolveSitemapRequest(
  fileName: string,
  { origin, tools, videos = [], maxUrls }: ResolveOptions,
): SitemapResponse {
  const files = getSitemapFiles(tools, maxUrls, videos);
  const path = `/${fileName}`;

  if (path === SITEMAP_INDEX_PATH) {
    return { type: "xml", body: buildSitemapIndexXml(origin, files) };
  }

  const file = files.find((candidate) => candidate.path === path);
  if (file) {
    const body =
      file.group === "videos" ? buildVideoUrlsetXml(origin, file.videos) : buildUrlsetXml(origin, file.paths);
    return { type: "xml", body };
  }

  const redirectPath = getLegacyRedirectPath(fileName, files);
  if (redirectPath) {
    return { type: "redirect", location: `${origin}${redirectPath}` };
  }

  return { type: "not-found" };
}

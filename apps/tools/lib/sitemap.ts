import { categoryHref } from "./catalog/href.ts";
import { operationsUsedBy } from "./catalog/operations.ts";

// The sitemap tree follows the serp sitemap standard
// (serpcompany/serp docs/engineering/websites/features/xml-sitemaps.md):
// /sitemap-index.xml lists root-level URL sets named by content group, such as
// /sitemap-tools.xml, and never another index. A group that passes the
// per-file URL limit continues in /sitemap-tools-2.xml, /sitemap-tools-3.xml.

export const SITEMAP_INDEX_PATH = "/sitemap-index.xml";

// The sitemaps.org limit for one URL set.
export const MAX_URLS_PER_SITEMAP = 50_000;

export const STATIC_PATHS = ["/", "/categories/", "/brands/"];

const SITEMAP_GROUPS = ["pages", "tools", "categories"] as const;
type SitemapGroup = (typeof SITEMAP_GROUPS)[number];

export type SitemapTool = {
  route?: string | null;
  isActive: boolean;
  operation: string;
};

export type SitemapFile = {
  group: SitemapGroup;
  path: string;
  paths: string[];
};

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

export function getCategoryPaths(tools: readonly SitemapTool[]) {
  return operationsUsedBy(tools).map(categoryHref).map(normalizePath);
}

function getGroupPaths(tools: readonly SitemapTool[]): Record<SitemapGroup, string[]> {
  return {
    pages: STATIC_PATHS.map(normalizePath),
    tools: getToolPaths(tools),
    categories: getCategoryPaths(tools),
  };
}

// Every URL-set file, in index order. A path appears once across the whole
// tree, in the first group that lists it. Empty groups get no file.
export function getSitemapFiles(
  tools: readonly SitemapTool[],
  maxUrls: number = MAX_URLS_PER_SITEMAP,
): SitemapFile[] {
  const groupPaths = getGroupPaths(tools);
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
  maxUrls?: number;
};

// What to answer for a root-level sitemap file name such as
// "sitemap-tools.xml": the XML, a 308 target for a retired name, or 404.
export function resolveSitemapRequest(
  fileName: string,
  { origin, tools, maxUrls }: ResolveOptions,
): SitemapResponse {
  const files = getSitemapFiles(tools, maxUrls);
  const path = `/${fileName}`;

  if (path === SITEMAP_INDEX_PATH) {
    return { type: "xml", body: buildSitemapIndexXml(origin, files) };
  }

  const file = files.find((candidate) => candidate.path === path);
  if (file) {
    return { type: "xml", body: buildUrlsetXml(origin, file.paths) };
  }

  const redirectPath = getLegacyRedirectPath(fileName, files);
  if (redirectPath) {
    return { type: "redirect", location: `${origin}${redirectPath}` };
  }

  return { type: "not-found" };
}

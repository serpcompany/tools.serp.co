import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const appRoot = path.resolve(scriptsRoot, "..");
export const repoRoot = path.resolve(appRoot, "../..");

// Must match MAX_URLS_PER_SITEMAP in lib/sitemap.ts.
export const MAX_URLS_PER_SITEMAP = 50000;

export const OPERATION_ORDER = [
  "convert",
  "download",
  "compress",
  "combine",
  "bulk",
  "edit",
  "video-editor",
  "image-editor",
  "audio-editor",
  "view",
];

const TEXT_FILE_EXTENSIONS = new Set([".txt", ".xml"]);
const DEFAULT_STATIC_PATHS = ["/", "/categories/", "/brands/"];
const LEGACY_DOWNLOADER_REDIRECTS = [
  {
    path: "/download-kajab-videos/",
    target: "/download-kajabi-videos/",
  },
  {
    path: "/download-stripcha-videos/",
    target: "/download-stripchat-videos/",
  },
];

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function normalizePathname(value) {
  if (!value) return "/";
  const rawPath = value.startsWith("/") ? value : `/${value}`;
  const [pathname, suffix = ""] = rawPath.split(/([?#].*)/, 2);
  if (pathname === "/") return `/${suffix}`;
  const extension = path.extname(pathname);
  if (TEXT_FILE_EXTENSIONS.has(extension)) return `${pathname.replace(/\/$/, "")}${suffix}`;
  return `${pathname.replace(/\/$/, "")}/${suffix}`;
}

export function stripTrailingSlash(value) {
  if (value === "/") return value;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function collectFiles(dir, predicate = () => true) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const queue = [dir];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".devin" || entry.name === "node_modules") continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && predicate(fullPath)) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

export function routeFromAppFile(filePath) {
  const appDir = path.join(appRoot, "app");
  const relativeDir = path.relative(appDir, path.dirname(filePath));
  if (!relativeDir || relativeDir === ".") return "/";

  const parts = relativeDir
    .split(path.sep)
    .filter((part) => part && !/^\(.*\)$/.test(part));

  if (!parts.length) return "/";
  return normalizePathname(`/${parts.join("/")}`);
}

export function getToolsData() {
  return readJsonFile(path.join(repoRoot, "packages/app-core/src/data/tools.json"));
}

export function getActiveTools(tools = getToolsData()) {
  return tools.filter((tool) => tool?.isActive && tool?.route);
}

export function getOperationCounts(tools = getActiveTools()) {
  const counts = {};
  for (const tool of tools) {
    const operation = tool.operation || "unknown";
    counts[operation] = (counts[operation] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function getCategoryPaths(tools = getActiveTools()) {
  const operations = new Set();
  for (const tool of tools) {
    if (OPERATION_ORDER.includes(tool.operation)) {
      operations.add(tool.operation);
    }
  }
  return OPERATION_ORDER.filter((operation) => operations.has(operation)).map(
    (operation) => `/category/${operation}/`,
  );
}

function addRoute(routes, pathValue, source, metadata = {}) {
  const pathname = normalizePathname(pathValue);
  const existing = routes.get(pathname);
  if (existing) {
    existing.sources = Array.from(new Set([...existing.sources, source])).sort();
    existing.metadata = { ...existing.metadata, ...metadata };
    return;
  }
  routes.set(pathname, {
    path: pathname,
    sources: [source],
    metadata,
  });
}

export function buildRouteManifest(options = {}) {
  const includeInternal = Boolean(options.includeInternal);
  const includeNoSlash = Boolean(options.includeNoSlash);
  const tools = getToolsData();
  const activeTools = getActiveTools(tools);
  const routes = new Map();

  for (const pathname of DEFAULT_STATIC_PATHS) {
    addRoute(routes, pathname, "static-page");
  }

  for (const pathname of getCategoryPaths(activeTools)) {
    addRoute(routes, pathname, "category-page");
  }

  for (const tool of activeTools) {
    addRoute(routes, tool.route, "tool-registry", {
      toolId: tool.id,
      operation: tool.operation ?? null,
      requiresFFmpeg: Boolean(tool.requiresFFmpeg),
    });
  }

  const pageFiles = collectFiles(path.join(appRoot, "app"), (filePath) =>
    filePath.endsWith(`${path.sep}page.tsx`),
  );
  for (const filePath of pageFiles) {
    const routePath = routeFromAppFile(filePath);
    if (routePath.includes("[tool]") || routePath.includes("[categoryName]")) continue;
    if (routePath.startsWith("/internal/")) {
      if (includeInternal) addRoute(routes, routePath, "internal-page", { requiresToken: true });
      continue;
    }
    addRoute(routes, routePath, "app-page");
  }

  // The flat sitemap tree from lib/sitemap.ts: one root-level URL set per
  // content group, numbered from -2 when a group passes the URL limit.
  const sitemapFileCount = (count) => Math.ceil(count / MAX_URLS_PER_SITEMAP);
  const sitemapGroups = {
    pages: DEFAULT_STATIC_PATHS.length,
    tools: activeTools.length,
    categories: getCategoryPaths(activeTools).length,
  };
  const sitemapPaths = ["/robots.txt", "/ads.txt", "/sitemap-index.xml"];
  for (const [group, count] of Object.entries(sitemapGroups)) {
    for (let part = 1; part <= sitemapFileCount(count); part += 1) {
      sitemapPaths.push(part === 1 ? `/sitemap-${group}.xml` : `/sitemap-${group}-${part}.xml`);
    }
  }

  for (const pathname of sitemapPaths) {
    addRoute(routes, pathname, "seo-route");
  }

  for (const redirect of LEGACY_DOWNLOADER_REDIRECTS) {
    addRoute(routes, redirect.path, "legacy-redirect", {
      expectedRedirectPath: redirect.target,
    });
  }

  const routeList = Array.from(routes.values()).sort((a, b) => a.path.localeCompare(b.path));
  if (!includeNoSlash) {
    return routeList;
  }

  const noSlashRoutes = [];
  for (const route of routeList) {
    if (route.path === "/" || !route.path.endsWith("/")) continue;
    const noSlashPath = stripTrailingSlash(route.path);
    noSlashRoutes.push({
      path: noSlashPath,
      sources: [...route.sources, "trailing-slash-check"].sort(),
      metadata: {
        ...route.metadata,
        canonicalPath: route.path,
        expectedRedirectPath: route.path,
      },
    });
  }

  return [...routeList, ...noSlashRoutes].sort((a, b) => a.path.localeCompare(b.path));
}

export function getAppSourceCounts() {
  const appDir = path.join(appRoot, "app");
  const sourceFiles = collectFiles(appDir, (filePath) =>
    /[/\\](page|route|layout|loading|error|not-found|template)\.(tsx|ts)$/.test(filePath),
  );
  const pageFiles = sourceFiles.filter((filePath) => filePath.endsWith(`${path.sep}page.tsx`));
  const routeFiles = sourceFiles.filter((filePath) => filePath.endsWith(`${path.sep}route.ts`));
  return {
    sourceFiles: sourceFiles.length,
    pageFiles: pageFiles.length,
    routeFiles: routeFiles.length,
  };
}

export function getGitSnapshot() {
  const runGit = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };

  return {
    branch: runGit(["branch", "--show-current"]),
    commit: runGit(["rev-parse", "HEAD"]),
    shortStatus: runGit(["status", "--short"]),
  };
}

export function getWranglerConfig() {
  const wranglerPath = path.join(appRoot, "wrangler.jsonc");
  const raw = fs.existsSync(wranglerPath) ? fs.readFileSync(wranglerPath, "utf8") : "";
  if (!raw) return null;
  return JSON.parse(raw);
}

export function getPackageScripts() {
  const appPackage = readJsonFile(path.join(appRoot, "package.json"));
  const rootPackage = readJsonFile(path.join(repoRoot, "package.json"));
  return {
    app: appPackage.scripts ?? {},
    root: rootPackage.scripts ?? {},
    appDependencies: appPackage.dependencies ?? {},
    appDevDependencies: appPackage.devDependencies ?? {},
    rootPackageManager: rootPackage.packageManager ?? null,
    rootEngines: rootPackage.engines ?? {},
  };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

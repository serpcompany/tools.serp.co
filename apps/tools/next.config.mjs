import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ffmpegPath from "ffmpeg-static";

const require = createRequire(import.meta.url);
// require.resolve gives the package's CommonJS build; its browser build sits
// beside it.
const pptxGlimpseBrowser = path.join(path.dirname(require.resolve("pptx-glimpse")), "browser.js");
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const svgFontNoFs = path.resolve(appRoot, "lib/convert/svg-font-no-fs.ts");
const tracingRoot = path.resolve(appRoot, "../..");
const toolsPath = path.resolve(appRoot, "lib/catalog/tools.json");
const appDir = path.resolve(appRoot, "app");
let ffmpegRoutes = [];
const transcribeRoutes = new Set();
// Multi-thread FFmpeg needs cross-origin isolation (COEP), and the worker
// scripts don't send COEP headers yet: turning this off breaks FFmpeg and
// transcription pages until they do (PR #213).
const singleThreadEnv = process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD ?? "true";
const useSingleThread = singleThreadEnv === "true";

function normalizeRoute(route) {
  if (!route) return null;
  const normalized = String(route).replace(/\/$/, "");
  return normalized.length ? normalized : "/";
}

function routeFromFilePath(filePath) {
  const relative = path.relative(appDir, path.dirname(filePath));
  if (!relative || relative === ".") return "/";
  const parts = relative.split(path.sep).filter((part) => part && !/^\(.*\)$/.test(part));
  return normalizeRoute(`/${parts.join("/")}`);
}

function collectTranscribeRoutes() {
  if (!fs.existsSync(appDir)) return;
  const queue = [appDir];
  while (queue.length) {
    const current = queue.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== "page.tsx") continue;
      const source = fs.readFileSync(fullPath, "utf8");
      if (!source.includes("TranscribeTool")) continue;
      const toolIdMatch = source.match(/const toolId = ['"]([^'"]+)['"]/);
      const toolId = toolIdMatch?.[1];
      if (toolId) {
        transcribeRoutes.add({ toolId, fallbackRoute: routeFromFilePath(fullPath) });
      } else {
        transcribeRoutes.add({ toolId: null, fallbackRoute: routeFromFilePath(fullPath) });
      }
    }
  }
}

try {
  const toolsJson = JSON.parse(fs.readFileSync(toolsPath, "utf8"));
  collectTranscribeRoutes();
  const seenRoutes = new Set();
  const transcribeRouteSet = new Set(
    Array.from(transcribeRoutes)
      .map((entry) => {
        if (!entry.toolId) return entry.fallbackRoute;
        const tool = toolsJson.find((candidate) => candidate?.id === entry.toolId);
        return normalizeRoute(tool?.route) ?? entry.fallbackRoute;
      })
      .filter(Boolean)
  );
  const includeFfmpegRoutes = !useSingleThread;
  ffmpegRoutes = toolsJson
    .filter((tool) => {
      if (!tool?.isActive || !tool?.route) return false;
      const normalizedRoute = normalizeRoute(tool.route);
      if (!normalizedRoute) return false;
      return includeFfmpegRoutes && (transcribeRouteSet.has(normalizedRoute) || tool?.requiresFFmpeg);
    })
    .map((tool) => normalizeRoute(tool.route))
    .filter((route) => {
      if (!route || seenRoutes.has(route)) return false;
      seenRoutes.add(route);
      return true;
    });
  // Like other FFmpeg pages, transcription pages are only isolated for
  // multi-threaded FFmpeg. Their Worker scripts are served without a COEP
  // header, so Chrome refuses them on an isolated page and transcription
  // hangs (issue #171).
  for (const route of includeFfmpegRoutes ? transcribeRouteSet : []) {
    if (!route || seenRoutes.has(route)) continue;
    seenRoutes.add(route);
    ffmpegRoutes.push(route);
  }
} catch {
  ffmpegRoutes = [];
}
const ffmpegDir = ffmpegPath ? path.dirname(ffmpegPath) : null;
const ffmpegTrace = ffmpegDir ? `./${path.relative(tracingRoot, ffmpegDir)}/**` : null;
let magickTrace = null;
try {
  const magickWasmPath = require.resolve("@imagemagick/magick-wasm/magick.wasm");
  magickTrace = `./${path.relative(tracingRoot, magickWasmPath)}`;
} catch {
  magickTrace = null;
}
let ytDlpTrace = null;
try {
  const ytDlpRoot = path.dirname(require.resolve("youtube-dl-exec/package.json"));
  const ytDlpBinDir = path.resolve(ytDlpRoot, "bin");
  ytDlpTrace = `./${path.relative(tracingRoot, ytDlpBinDir)}/**`;
} catch {
  ytDlpTrace = null;
}

const outputFileTracingIncludes = {};
if (ffmpegTrace) {
  outputFileTracingIncludes["/app/api/video-convert"] = [ffmpegTrace];
  outputFileTracingIncludes["/app/api/image-convert"] = magickTrace
    ? [ffmpegTrace, magickTrace]
    : [ffmpegTrace];
} else if (magickTrace) {
  outputFileTracingIncludes["/app/api/image-convert"] = [magickTrace];
}
if (ytDlpTrace) {
  outputFileTracingIncludes["/app/api/media-fetch"] = [ytDlpTrace];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use the Next.js server runtime compiled by OpenNext (no static export)
  // Deploys with a Sentry auth token build browser source maps, upload them
  // to Sentry and delete them before deploying (.github/workflows/deploy.yml).
  productionBrowserSourceMaps: process.env.SENTRY_SOURCEMAPS === "true",
  transpilePackages: [
    "@jsquash/jpeg",
    "@jsquash/oxipng",
    "@kreuzberg/html-to-markdown-wasm",
    "@serp-tools/ui",
    "@serp-tools/tool-telemetry",
  ],
  trailingSlash: true,
  // middleware.ts applies the trailing-slash rules (lib/trailing-slash.ts).
  skipTrailingSlashRedirect: true,
  // Blocking metadata for every user agent, not only Next's list of
  // HTML-limited bots: <title>, the description, rel=canonical and og tags
  // are always in <head>. Streamed, they land in <body> whenever a dynamic
  // page's RSC payload outruns them: 354 [tool] pages did for browsers and
  // Googlebot. Requests with no User-Agent still stream.
  htmlLimitedBots: /.*/,
  env: {
    BUILD_MODE: "server",
    SUPPORTS_VIDEO_CONVERSION: "true",
    NEXT_PUBLIC_FFMPEG_SINGLE_THREAD: singleThreadEnv,
  },
  outputFileTracingRoot: tracingRoot,
  outputFileTracingIncludes,
  webpack(config, { isServer, webpack }) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    // pptx-glimpse's browser build (PPTX to an image, lib/convert/pptx.worker.ts).
    // Its exports name it under a "browser" condition this build doesn't use,
    // and its Node build imports Node-only modules.
    config.resolve.alias = { ...config.resolve.alias, "pptx-glimpse$": pptxGlimpseBrowser };
    if (!isServer) {
      // svgicons2svgfont and yerror, which SVG to TTF runs in the browser
      // (lib/convert/svg-font.ts), import Node's modules by "node:" names,
      // which this build can't read. Their imports, and only theirs, get
      // Next's browser stand-ins for stream, path and os, and a file system
      // that throws (lib/convert/svg-font-no-fs.ts): only svgicons2svgfont's
      // folder helpers use it, and SVG to TTF never calls them. An import of
      // fs from anywhere else still fails the build.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:(fs|os|path|stream)$/, (resource) => {
          if (/[\\/](svgicons2svgfont|yerror)[\\/]/.test(resource.contextInfo?.issuer ?? "")) {
            resource.request = resource.request === "node:fs" ? svgFontNoFs : resource.request.slice("node:".length);
          }
        }),
      );
    }
    config.output = { ...config.output, hashFunction: "sha256" };
    return config;
  },
  async headers() {
    const isolationHeaders = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    ];

    return ffmpegRoutes.map((route) => ({
      source: `${route}/:path*`,
      headers: isolationHeaders,
    }));
  },
  async rewrites() {
    return [
      // Root-level sitemap files: /sitemap.xml, /sitemap-<group>.xml and the
      // retired /pages-0.xml-style names, which 308 to the flat tree
      // (lib/sitemap.ts). /sitemap-index.xml has its own route and is
      // matched before this rewrite.
      {
        source: "/:file((?:sitemap|pages|tools|categories)(?:-[a-z0-9-]+)?\\.xml)",
        destination: "/sitemaps/:file",
      },
    ];
  },
};

export default nextConfig;

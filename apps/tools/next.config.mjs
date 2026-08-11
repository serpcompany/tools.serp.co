import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ffmpegPath from "ffmpeg-static";
import { operationalToolCatalog } from "@serp-tools/app-core/lib/tool-catalog-adapter";

const require = createRequire(import.meta.url);
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const tracingRoot = path.resolve(appRoot, "../..");
const appDir = path.resolve(appRoot, "app");
let ffmpegRoutes = [];
const transcribeRoutes = new Set();
const singleThreadEnv = process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD ?? "true";
const useSingleThread = singleThreadEnv === "true";

function routeFromFilePath(filePath) {
  const relative = path.relative(appDir, path.dirname(filePath));
  if (!relative || relative === ".") return "/";
  const parts = relative.split(path.sep).filter((part) => part && !/^\(.*\)$/.test(part));
  return `/${parts.join("/")}`;
}

function nestedRoutePattern(route) {
  return `${route.replace(/\/$/, "")}/:path*`;
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
  collectTranscribeRoutes();
  const seenRoutes = new Set();
  const transcribeRouteSet = new Set(
    Array.from(transcribeRoutes)
      .map((entry) => {
        if (!entry.toolId) return entry.fallbackRoute;
        const tool = operationalToolCatalog.tools.find(
          (candidate) => candidate.id === entry.toolId,
        );
        return tool?.canonicalRoute ?? entry.fallbackRoute;
      })
      .filter(Boolean)
  );
  const includeFfmpegRoutes = !useSingleThread;
  ffmpegRoutes = operationalToolCatalog.activeTools
    .filter((tool) => {
      return (
        transcribeRouteSet.has(tool.canonicalRoute) ||
        (includeFfmpegRoutes && tool.requiresFFmpeg)
      );
    })
    .map((tool) => tool.canonicalRoute)
    .filter((route) => {
      if (!route || seenRoutes.has(route)) return false;
      seenRoutes.add(route);
      return true;
    });
  for (const route of transcribeRouteSet) {
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
  transpilePackages: [
    "@jsquash/jpeg",
    "@jsquash/oxipng",
    "@kreuzberg/html-to-markdown-wasm",
    "@serp-tools/ui",
    "@serp-tools/tool-telemetry",
  ],
  trailingSlash: true,
  env: {
    BUILD_MODE: "server",
    SUPPORTS_VIDEO_CONVERSION: "true",
    NEXT_PUBLIC_FFMPEG_SINGLE_THREAD: singleThreadEnv,
    NEXT_PUBLIC_VIDEO_CONVERSION_PREFER_SERVER: "true",
  },
  outputFileTracingRoot: tracingRoot,
  outputFileTracingIncludes,
  webpack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.output = { ...config.output, hashFunction: "sha256" };
    return config;
  },
  async headers() {
    const isolationHeaders = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    ];

    return [
      ...ffmpegRoutes.map((route) => ({
        source: nestedRoutePattern(route),
        headers: isolationHeaders,
      })),
      {
        source: "/_next/static/chunks/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/sitemap-:page.xml",
        destination: "/sitemap/:page",
      },
      {
        source: "/pages-:page.xml",
        destination: "/sitemaps/pages/:page",
      },
      {
        source: "/tools-:page.xml",
        destination: "/sitemaps/tools/:page",
      },
      {
        source: "/categories-:page.xml",
        destination: "/sitemaps/categories/:page",
      },
    ];
  },
};

export default nextConfig;

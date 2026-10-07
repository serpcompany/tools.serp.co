import fs from "node:fs/promises";
import path from "node:path";

import { validateCatalog } from "../apps/tools/lib/catalog/validate.ts";

const root = process.cwd();
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

// The Tool registry matches the type lib/catalog/catalog.ts casts it to. The
// app never validates it at runtime.
const registryPath = path.join(root, "apps/tools/lib/catalog/tools.json");
for (const error of validateCatalog(JSON.parse(await fs.readFile(registryPath, "utf8")))) {
  fail(`Tool registry: ${error}`);
}

const workersDir = path.join(root, "apps/tools/workers");
if (!(await pathExists(workersDir))) {
  fail("Missing workers directory at apps/tools/workers.");
} else {
  const workerFiles = await fs.readdir(workersDir);
  const tsWorkers = workerFiles.filter((file) => file.endsWith(".worker.ts") || file.endsWith(".worker.tsx"));
  if (tsWorkers.length) {
    fail(`Worker files must be .js only. Found: ${tsWorkers.join(", ")}`);
  }

  const requiredWorkers = ["convert.worker.js", "compress.worker.js"];
  for (const file of requiredWorkers) {
    if (!(await pathExists(path.join(workersDir, file)))) {
      fail(`Missing worker file: apps/tools/workers/${file}`);
    }
  }

  const jsWorkers = workerFiles.filter((file) => file.endsWith(".js"));
  const typePattern = /:\s*(number|string|boolean|ArrayBuffer|MessageEvent|Transferable|Worker|Promise)\b/;
  for (const file of jsWorkers) {
    const content = await fs.readFile(path.join(workersDir, file), "utf8");
    if (typePattern.test(content)) {
      fail(`Worker ${file} contains TypeScript type annotations.`);
    }
  }
}

const componentsDir = path.join(root, "apps/tools/components");
if (await pathExists(componentsDir)) {
  const componentFiles = (await listFiles(componentsDir)).filter((file) => file.endsWith(".tsx"));
  for (const file of componentFiles) {
    const content = await fs.readFile(file, "utf8");
    if (content.includes(".worker.ts")) {
      fail(`Worker URL must use .js extension in ${path.relative(root, file)}.`);
    }
  }
} else {
  warn("Components directory missing; skipping worker URL checks.");
}

const toolsPackagePath = path.join(root, "apps/tools/package.json");
if (await pathExists(toolsPackagePath)) {
  const toolsPackage = JSON.parse(await fs.readFile(toolsPackagePath, "utf8"));
  const devScript = toolsPackage.scripts?.dev ?? "";
  if (!devScript.includes("next dev")) {
    fail("apps/tools/package.json dev script must run next dev.");
  }
  if (devScript.includes("--turbopack")) {
    fail("apps/tools/package.json dev script must not use --turbopack (module workers break).");
  }
  const deps = { ...(toolsPackage.dependencies ?? {}), ...(toolsPackage.devDependencies ?? {}) };
  if (!deps["ffmpeg-static"]) {
    fail("apps/tools/package.json must include ffmpeg-static.");
  }
} else {
  fail("Missing apps/tools/package.json.");
}

const nextConfigPath = path.join(root, "apps/tools/next.config.mjs");
if (await pathExists(nextConfigPath)) {
  const nextConfig = await fs.readFile(nextConfigPath, "utf8");
  if (!nextConfig.includes("Cross-Origin-Opener-Policy")) {
    fail("next.config.mjs must set Cross-Origin-Opener-Policy header.");
  }
  if (!nextConfig.includes("Cross-Origin-Embedder-Policy")) {
    fail("next.config.mjs must set Cross-Origin-Embedder-Policy header.");
  }
  if (!nextConfig.includes("SUPPORTS_VIDEO_CONVERSION")) {
    fail("next.config.mjs must set SUPPORTS_VIDEO_CONVERSION env.");
  }
  if (!nextConfig.includes("BUILD_MODE")) {
    fail("next.config.mjs must set BUILD_MODE env.");
  }
  if (!nextConfig.includes('destination: "/sitemaps/:file"')) {
    fail("next.config.mjs must rewrite root-level sitemap files (/sitemap-<group>.xml, /sitemap.xml) to /sitemaps/:file.");
  }
  if (/sitemaps\/(?:pages|tools|categories)\//.test(nextConfig)) {
    fail("next.config.mjs must not rewrite to the retired /sitemaps/<group>/:page routes.");
  }
} else {
  fail("Missing apps/tools/next.config.mjs.");
}

const vendorAssets = [
  "apps/tools/public/vendor/pdfjs/pdf.worker.min.js",
  "apps/tools/public/vendor/libheif/libheif-bundle.js",
  "apps/tools/public/vendor/libheif/libheif.wasm",
  "apps/tools/public/vendor/ffmpeg/ffmpeg-core.js",
  "apps/tools/public/vendor/ffmpeg/ffmpeg-core.wasm",
  "apps/tools/public/vendor/ffmpeg/ffmpeg-core.worker.js",
  "apps/tools/public/vendor/ffmpeg-st/ffmpeg-core.js",
  "apps/tools/public/vendor/ffmpeg-st/ffmpeg-core.wasm",
];
for (const asset of vendorAssets) {
  if (!(await pathExists(path.join(root, asset)))) {
    fail(`Missing vendor asset: ${asset}`);
  }
}

const pdfConvertPath = path.join(root, "apps/tools/lib/convert/pdf.ts");
if (await pathExists(pdfConvertPath)) {
  const pdfConvert = await fs.readFile(pdfConvertPath, "utf8");
  if (!pdfConvert.includes("pdfjs-dist/legacy/build/pdf")) {
    fail("pdf.ts must import pdfjs-dist/legacy/build/pdf.");
  }
}

const workerClientPath = path.join(root, "apps/tools/lib/convert/workerClient.ts");
if (await pathExists(workerClientPath)) {
  const workerClient = await fs.readFile(workerClientPath, "utf8");
  if (!workerClient.includes("isWorkerError")) {
    fail("workerClient.ts must detect worker errors for fallback.");
  }
  if (!workerClient.includes("convertVideoOnMainThread")) {
    fail("workerClient.ts must include main-thread video fallback.");
  }
}

const requiredTestIds = [
  {
    file: "apps/tools/components/HeroConverter.tsx",
    ids: ["tool-dropzone", "tool-file-input"],
  },
  {
    file: "apps/tools/components/LanderHeroTwoColumn.tsx",
    ids: ["tool-dropzone", "tool-file-input"],
  },
  {
    file: "apps/tools/components/Converter.tsx",
    ids: ["tool-dropzone", "tool-file-input", "tool-progress"],
  },
  {
    file: "apps/tools/components/BatchHeroConverter.tsx",
    ids: ["batch-compress-dropzone", "batch-compress-input", "batch-compress-download", "batch-progress"],
  },
  {
    file: "apps/tools/components/CsvCombiner.tsx",
    ids: ["csv-combiner-dropzone", "csv-combiner-input", "csv-combiner-download"],
  },
  {
    file: "apps/tools/components/JsonToCsv.tsx",
    ids: ["json-input", "json-convert", "json-to-csv-download"],
  },
  {
    file: "apps/tools/components/VideoProgress.tsx",
    ids: ["video-progress"],
  },
];

for (const entry of requiredTestIds) {
  const fullPath = path.join(root, entry.file);
  if (!(await pathExists(fullPath))) {
    fail(`Missing ${entry.file} for test id checks.`);
    continue;
  }
  const content = await fs.readFile(fullPath, "utf8");
  for (const id of entry.ids) {
    if (!content.includes(`data-testid="${id}"`)) {
      fail(`${entry.file} must include data-testid="${id}".`);
    }
  }
}

// The flat sitemap tree (serp xml-sitemaps standard): /sitemap-index.xml lists
// root-level /sitemap-<group>.xml URL sets and never another index.
const sitemapIndexPath = path.join(root, "apps/tools/app/sitemap-index.xml/route.ts");
if (!(await pathExists(sitemapIndexPath))) {
  fail("Missing apps/tools/app/sitemap-index.xml/route.ts.");
}

const sitemapFilesPath = path.join(root, "apps/tools/app/sitemaps/[file]/route.ts");
if (!(await pathExists(sitemapFilesPath))) {
  fail("Missing apps/tools/app/sitemaps/[file]/route.ts (serves /sitemap-<group>.xml).");
}

const sitemapLibPath = path.join(root, "apps/tools/lib/sitemap.ts");
if (await pathExists(sitemapLibPath)) {
  const sitemapLib = await fs.readFile(sitemapLibPath, "utf8");
  if (!sitemapLib.includes("`/sitemap-${group}.xml`")) {
    fail("lib/sitemap.ts must name child sitemaps /sitemap-<group>.xml.");
  }
} else {
  fail("Missing apps/tools/lib/sitemap.ts.");
}

for (const retired of [
  "apps/tools/app/pages-index.xml",
  "apps/tools/app/tools-index.xml",
  "apps/tools/app/categories-index.xml",
  "apps/tools/app/sitemap/[page]",
]) {
  if (await pathExists(path.join(root, retired))) {
    fail(`${retired} is a retired nested sitemap route; retired names 308 via lib/sitemap.ts.`);
  }
}

if (warnings.length) {
  console.warn("Tools SOP warnings:");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

if (errors.length) {
  console.error("Tools SOP checks failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Tools SOP checks passed.");

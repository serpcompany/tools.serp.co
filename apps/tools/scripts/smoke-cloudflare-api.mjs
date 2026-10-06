import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  appRoot,
  getWranglerConfig,
  repoRoot,
} from "./lib/cloudflare-audit.mjs";

const DEFAULT_TIMEOUT_MS = 30000;
// Must match SMOKE_TEST_HEADER in lib/site-environment.ts. It lets the smoke
// test reach a deployment through its *.workers.dev host without the
// canonical-host redirect.
const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";
const ENVIRONMENTS = new Set(["production", "staging"]);

function parseArgs(argv) {
  if (argv[0] === "--") {
    argv.shift();
  }

  const wrangler = getWranglerConfig();
  const args = {
    baseUrl: process.env.CLOUDFLARE_BASE_URL || "",
    internalToken: process.env.INTERNAL_DASHBOARD_TOKEN || "",
    assetBaseUrl:
      process.env.NEXT_PUBLIC_ASSETS_BASE_URL ||
      wrangler?.vars?.NEXT_PUBLIC_ASSETS_BASE_URL ||
      "https://assets.tools.serp.co",
    mediaUrl: process.env.MEDIA_FETCH_SMOKE_URL || "",
    reportPath: "",
    jsonPath: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    allowTelemetryWrite: false,
    includeNative: false,
    noFail: false,
    expectEnv: "",
    platformUrl: "",
    skipAssets: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      args.baseUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--internal-token") {
      args.internalToken = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--asset-base-url") {
      args.assetBaseUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--media-url") {
      args.mediaUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--report") {
      args.reportPath = path.resolve(repoRoot, argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--json") {
      args.jsonPath = path.resolve(repoRoot, argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--allow-telemetry-write") {
      args.allowTelemetryWrite = true;
      continue;
    }
    if (arg === "--include-native") {
      args.includeNative = true;
      continue;
    }
    if (arg === "--expect-env") {
      args.expectEnv = argv[index + 1] ?? "";
      if (!args.expectEnv) throw new Error("--expect-env needs production or staging");
      index += 1;
      continue;
    }
    if (arg === "--platform-url") {
      args.platformUrl = argv[index + 1] ?? "";
      if (!args.platformUrl) throw new Error("--platform-url needs a URL");
      index += 1;
      continue;
    }
    if (arg === "--skip-assets") {
      args.skipAssets = true;
      continue;
    }
    if (arg === "--no-fail") {
      args.noFail = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(
        [
          "Usage: node scripts/smoke-cloudflare-api.mjs --base-url <url> [options]",
          "",
          "Options:",
          "  --asset-base-url <url>       Asset host for FFmpeg static assets.",
          "  --internal-token <token>     Token for /internal/tools dashboard readback.",
          "  --allow-telemetry-write      POST a synthetic telemetry event.",
          "  --include-native             Exercise native processor APIs.",
          "  --media-url <url>            Public media URL for /api/media-fetch.",
          "  --timeout-ms <n>             Per-request timeout. Default 30000.",
          "  --report <path>              Write a Markdown report.",
          "  --json <path>                Write raw JSON results.",
          "  --expect-env <env>           Assert production or staging robots and noindex rules.",
          "  --platform-url <url>         Assert this *.workers.dev host 308s to the canonical host.",
          "  --skip-assets                Skip the asset-host checks (CI runners can be challenged there).",
          "  --no-fail                    Exit 0 even when checks fail.",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.baseUrl) {
    throw new Error("--base-url is required");
  }
  if (args.expectEnv && !ENVIRONMENTS.has(args.expectEnv)) {
    throw new Error("--expect-env must be production or staging");
  }
  if (args.platformUrl && !args.expectEnv) {
    throw new Error("--platform-url needs --expect-env to know the canonical host");
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000");
  }

  return args;
}

function withTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildUrl(baseUrl, pathname) {
  return new URL(pathname, withTrailingSlash(baseUrl)).toString();
}

function fixture(name) {
  return path.join(appRoot, "benchmarks/fixtures", name);
}

function readFixture(name) {
  return fs.readFileSync(fixture(name));
}

function contentTypeEssence(value) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

// A new deployment takes a few seconds to replace the old version
// everywhere, so right after a deploy (--expect-env) every check retries for
// a while before it counts as failed (staging run 37476911169).
const ROLLOUT_RETRY_MS = 30_000;

// Retries a check until it passes or its retry window runs out.
async function requestCheckWithRetry(check, args) {
  const retryForMs = check.retryForMs ?? (args.expectEnv ? ROLLOUT_RETRY_MS : 0);
  const deadline = Date.now() + retryForMs;
  let result = await requestCheck(check, args);
  while (!result.passed && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    result = await requestCheck(check, args);
  }
  return result;
}

async function requestCheck(check, args) {
  const startedAt = Date.now();
  try {
    const response = await fetch(check.url, {
      method: check.method ?? "GET",
      body: check.body,
      headers: {
        "user-agent": "tools-serp-cloudflare-api-smoke/1.0",
        ...(check.skipSmokeTestHeader ? {} : { [SMOKE_TEST_HEADER]: "1" }),
        ...(check.headers ?? {}),
      },
      redirect: check.redirect ?? "manual",
      signal: AbortSignal.timeout(check.timeoutMs ?? args.timeoutMs),
    });
    const contentType = response.headers.get("content-type");
    const bytes = Buffer.from(await response.arrayBuffer());
    const result = {
      name: check.name,
      status: response.status,
      ok: check.expect(response, bytes),
      durationMs: Date.now() - startedAt,
      contentType,
      contentLength: bytes.length,
      details: check.details?.(response, bytes) ?? null,
      error: null,
    };
    return {
      ...result,
      passed: result.ok,
    };
  } catch (error) {
    return {
      name: check.name,
      status: null,
      ok: false,
      passed: false,
      durationMs: Date.now() - startedAt,
      contentType: null,
      contentLength: 0,
      details: null,
      error: error instanceof Error ? error.message : "request failed",
    };
  }
}

function assetChecks(args) {
  const assetPaths = [
    "/vendor/ffmpeg/ffmpeg-core.js",
    "/vendor/ffmpeg/ffmpeg-core.wasm",
    "/vendor/ffmpeg/ffmpeg-core.worker.js",
    "/vendor/ffmpeg-st/ffmpeg-core.js",
    "/vendor/ffmpeg-st/ffmpeg-core.wasm",
  ];
  return assetPaths.map((assetPath) => ({
    name: `asset ${assetPath}`,
    url: buildUrl(args.assetBaseUrl, assetPath),
    headers: { range: "bytes=0-0" },
    expect: (response, bytes) => [200, 206].includes(response.status) && bytes.length > 0,
    details: (response, bytes) => ({
      contentType: response.headers.get("content-type"),
      contentRange: response.headers.get("content-range"),
      cacheControl: response.headers.get("cache-control"),
      bytes: bytes.length,
    }),
  }));
}

function safeGetChecks(args) {
  const paths = [
    "/",
    "/mp4-to-mp3/",
    "/download-loom-videos/",
    "/youtube-to-transcript/",
    "/pdf-editor/",
    "/robots.txt",
    "/sitemap-index.xml",
    "/sitemap-pages.xml",
    "/sitemap-tools.xml",
  ];
  const checks = paths.map((pathname) => ({
    name: `GET ${pathname}`,
    url: buildUrl(args.baseUrl, pathname),
    expect: (response, bytes) => response.status === 200 && bytes.length > 0,
    details: (response, bytes) => ({
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      bytes: bytes.length,
    }),
  }));

  // /sitemap.xml is an alias, and retired sitemap names move to the flat tree.
  const sitemapRedirects = {
    "/sitemap.xml": "/sitemap-index.xml",
    "/tools-index.xml": "/sitemap-index.xml",
    "/tools-0.xml": "/sitemap-tools.xml",
  };
  for (const [pathname, target] of Object.entries(sitemapRedirects)) {
    checks.push({
      name: `GET ${pathname} 308s to ${target}`,
      url: buildUrl(args.baseUrl, pathname),
      expect: (response) =>
        response.status === 308 &&
        new URL(response.headers.get("location") ?? "", args.baseUrl).pathname === target,
      details: (response) => ({ location: response.headers.get("location") }),
    });
  }

  if (args.internalToken) {
    checks.push({
      name: "GET /internal/tools/ with token",
      url: buildUrl(args.baseUrl, "/internal/tools/"),
      headers: {
        authorization: `Basic ${Buffer.from(`smoke:${args.internalToken}`).toString("base64")}`,
      },
      expect: (response, bytes) =>
        response.status === 200 && bytes.includes(Buffer.from("Tools Dashboard")),
      details: (response, bytes) => ({
        contentType: response.headers.get("content-type"),
        bytes: bytes.length,
      }),
    });
  }

  return checks;
}

// The canonical origin of an environment, from its wrangler vars, so the
// checks also work when --base-url is the *.workers.dev host.
function canonicalOrigin(expectEnv) {
  const siteUrl = getWranglerConfig()?.env?.[expectEnv]?.vars?.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error(`No NEXT_PUBLIC_SITE_URL for env.${expectEnv} in wrangler.jsonc`);
  return new URL(siteUrl).origin;
}

function sitemapLocs(bytes) {
  return [...bytes.toString("utf8").matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Must match the GTM id in gtag-manager.tsx (pinned by a test).
const GTM_CONTAINER = "GTM-PP9W77LK";
const ADSENSE_SCRIPT = "pagead/js/adsbygoogle.js";

function environmentChecks(args) {
  const checks = [];
  if (!args.expectEnv) return checks;
  const production = args.expectEnv === "production";
  const canonical = canonicalOrigin(args.expectEnv);

  checks.push(
    {
      name: `robots.txt matches ${args.expectEnv}`,
      url: buildUrl(args.baseUrl, "/robots.txt"),
      expect: (response, bytes) => {
        const body = bytes.toString("utf8");
        return production
          ? response.status === 200 &&
              body.includes("Allow: /") &&
              body.includes(`Sitemap: ${canonical}/sitemap-index.xml`)
          : response.status === 200 && body.includes("Disallow: /") && !body.includes("Sitemap:");
      },
      details: (_response, bytes) => ({ body: bytes.toString("utf8").slice(0, 200) }),
    },
    {
      name: `sitemap index lists only ${canonical}/sitemap-<group>.xml files`,
      url: buildUrl(args.baseUrl, "/sitemap-index.xml"),
      expect: (response, bytes) => {
        const locs = sitemapLocs(bytes);
        const child = new RegExp(`^${escapeRegExp(canonical)}/sitemap-[a-z]+(?:-\\d+)?\\.xml$`);
        return (
          response.status === 200 &&
          locs.includes(`${canonical}/sitemap-pages.xml`) &&
          locs.includes(`${canonical}/sitemap-tools.xml`) &&
          locs.every((loc) => child.test(loc))
        );
      },
      details: (_response, bytes) => ({ locs: sitemapLocs(bytes) }),
    },
    {
      name: `sitemap homepage is ${canonical} without a slash`,
      url: buildUrl(args.baseUrl, "/sitemap-pages.xml"),
      expect: (response, bytes) => {
        const locs = sitemapLocs(bytes);
        return (
          response.status === 200 &&
          locs.includes(canonical) &&
          locs.every((loc) => loc === canonical || (loc.startsWith(`${canonical}/`) && loc.endsWith("/")))
        );
      },
      details: (_response, bytes) => ({ locs: sitemapLocs(bytes) }),
    },
    {
      name: `X-Robots-Tag, analytics and ads match ${args.expectEnv}`,
      url: buildUrl(args.baseUrl, "/"),
      expect: (response, bytes) => {
        const tag = response.headers.get("x-robots-tag") ?? "";
        const hasGtm = bytes.includes(Buffer.from(GTM_CONTAINER));
        const hasAdSense = bytes.includes(Buffer.from(ADSENSE_SCRIPT));
        return (
          response.status === 200 &&
          (production
            ? !tag.includes("noindex") && hasGtm && hasAdSense
            : tag.includes("noindex") && !hasGtm && !hasAdSense)
        );
      },
      details: (response, bytes) => ({
        xRobotsTag: response.headers.get("x-robots-tag"),
        gtm: bytes.includes(Buffer.from(GTM_CONTAINER)),
        adsense: bytes.includes(Buffer.from(ADSENSE_SCRIPT)),
      }),
    },
  );

  // serp url-trailing-slash standard (issue #165, #167).
  const locationPath = (response) => {
    const location = response.headers.get("location");
    return location ? new URL(location, args.baseUrl).pathname : null;
  };
  checks.push(
    {
      name: "homepage canonical and og:url are the bare origin",
      url: buildUrl(args.baseUrl, "/"),
      expect: (response, bytes) => {
        const html = bytes.toString("utf8");
        return (
          response.status === 200 &&
          html.includes(`<link rel="canonical" href="${canonical}"/>`) &&
          html.includes(`<meta property="og:url" content="${canonical}"/>`)
        );
      },
      details: (_response, bytes) => ({
        canonical: bytes.toString("utf8").match(/<link rel="canonical"[^>]*>/)?.[0] ?? null,
      }),
    },
    {
      name: "a page without its slash 308s to the slashed page",
      url: buildUrl(args.baseUrl, "/png-to-jpg"),
      expect: (response) => response.status === 308 && locationPath(response) === "/png-to-jpg/",
      details: (response) => ({ location: response.headers.get("location") }),
    },
    {
      name: "a file with a slash 308s to the file",
      url: buildUrl(args.baseUrl, "/robots.txt/"),
      expect: (response) => response.status === 308 && locationPath(response) === "/robots.txt",
      details: (response) => ({ location: response.headers.get("location") }),
    },
    {
      name: "an old route 308s straight to its canonical page",
      url: buildUrl(args.baseUrl, "/download-kajab-videos"),
      expect: (response) =>
        response.status === 308 && locationPath(response) === "/download-kajabi-videos/",
      details: (response) => ({ location: response.headers.get("location") }),
    },
    ...["/api/telemetry", "/api/telemetry/"].map((path) => ({
      name: `POST ${path} is never redirected`,
      url: buildUrl(args.baseUrl, path),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
      expect: (response) => response.status === 400,
      details: (response) => ({ location: response.headers.get("location") }),
    })),
  );

  if (args.platformUrl) {
    checks.push({
      name: "platform host 308s /api to the canonical host, path unchanged",
      url: buildUrl(args.platformUrl, "/api/telemetry"),
      skipSmokeTestHeader: true,
      retryForMs: 30_000,
      expect: (response) =>
        response.status === 308 &&
        response.headers.get("location") === `${canonical}/api/telemetry`,
      details: (response) => ({ location: response.headers.get("location") }),
    });
    checks.push({
      name: "platform host 308s to the canonical host",
      url: buildUrl(args.platformUrl, "/png-to-jpg/?smoke=1"),
      skipSmokeTestHeader: true,
      // A new version takes a few seconds to replace the old one everywhere.
      retryForMs: 30_000,
      expect: (response) =>
        response.status === 308 &&
        response.headers.get("location") === `${canonical}/png-to-jpg/?smoke=1`,
      details: (response) => ({ location: response.headers.get("location") }),
    });
  }

  return checks;
}

function telemetryCheck(args) {
  const runId = `cf-audit-${crypto.randomUUID()}`;
  return {
    name: "POST /api/telemetry synthetic started event",
    url: buildUrl(args.baseUrl, "/api/telemetry"),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId,
      toolId: "cloudflare-audit",
      event: "tool_run_started",
      startedAt: new Date().toISOString(),
      metadata: {
        audit: "vercel-retirement-cloudflare",
      },
    }),
    expect: (response, bytes) => {
      if (response.status !== 200) return false;
      try {
        const json = JSON.parse(bytes.toString("utf8"));
        return json.ok === true;
      } catch {
        return false;
      }
    },
    details: (response, bytes) => ({
      contentType: response.headers.get("content-type"),
      body: bytes.toString("utf8").slice(0, 300),
      runId,
    }),
  };
}

function nativeChecks(args) {
  const checks = [
    {
      name: "POST /api/image-compress?format=svg",
      url: buildUrl(args.baseUrl, "/api/image-compress?format=svg"),
      method: "POST",
      headers: { "content-type": "image/svg+xml" },
      body: readFixture("sample.svg"),
      expect: (response, bytes) =>
        response.status === 200 &&
        contentTypeEssence(response.headers.get("content-type")) === "image/svg+xml" &&
        bytes.length > 0,
    },
    {
      name: "POST /api/image-convert?from=png&to=jpg",
      url: buildUrl(args.baseUrl, "/api/image-convert?from=png&to=jpg"),
      method: "POST",
      headers: { "content-type": "image/png" },
      body: readFixture("sample.png"),
      expect: (response, bytes) =>
        response.status === 200 &&
        contentTypeEssence(response.headers.get("content-type")) === "image/jpeg" &&
        bytes.length > 0,
    },
    {
      name: "POST /api/video-convert?from=mp4&to=mp3",
      url: buildUrl(args.baseUrl, "/api/video-convert?from=mp4&to=mp3"),
      method: "POST",
      headers: { "content-type": "video/mp4" },
      body: readFixture("sample.mp4"),
      timeoutMs: Math.max(args.timeoutMs, 60000),
      expect: (response, bytes) => response.status === 200 && bytes.length > 0,
    },
    {
      name: "POST /api/pdf-compress",
      url: buildUrl(args.baseUrl, "/api/pdf-compress"),
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: readFixture("sample.pdf"),
      timeoutMs: Math.max(args.timeoutMs, 60000),
      expect: (response, bytes) =>
        response.status === 200 &&
        contentTypeEssence(response.headers.get("content-type")) === "application/pdf" &&
        bytes.length > 0,
    },
  ];

  if (args.mediaUrl) {
    checks.push({
      name: "POST /api/media-fetch public media URL",
      url: buildUrl(args.baseUrl, "/api/media-fetch"),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: args.mediaUrl, mode: "video" }),
      timeoutMs: Math.max(args.timeoutMs, 60000),
      expect: (response, bytes) => response.status === 200 && bytes.length > 0,
    });
  }

  return checks.map((check) => ({
    ...check,
    details: (response, bytes) => ({
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      setCookie: Boolean(response.headers.get("set-cookie")),
      bytes: bytes.length,
      errorBody:
        response.status >= 400 ? bytes.toString("utf8").slice(0, 500) : undefined,
    }),
  }));
}

function skipped(name, reason) {
  return {
    name,
    status: null,
    ok: null,
    passed: true,
    skipped: true,
    durationMs: 0,
    contentType: null,
    contentLength: 0,
    details: { reason },
    error: null,
  };
}

function renderReport(payload) {
  const rows = payload.results.map((result) => {
    const status = result.skipped ? "skipped" : result.passed ? "passed" : "failed";
    const detail = result.error || JSON.stringify(result.details ?? {});
    return `| ${result.name} | ${status} | ${result.status ?? "-"} | ${result.durationMs} | ${detail.replaceAll("|", "\\|")} |`;
  });

  return [
    "# Cloudflare API Smoke Report",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    `- Base URL: ${payload.baseUrl}`,
    `- Asset base URL: ${payload.assetBaseUrl}`,
    `- Passed: ${payload.summary.passed}`,
    `- Failed: ${payload.summary.failed}`,
    `- Skipped: ${payload.summary.skipped}`,
    "",
    "| check | result | status | ms | details |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
const checks = [
  ...(args.skipAssets ? [] : assetChecks(args)),
  ...safeGetChecks(args),
  ...environmentChecks(args),
];
if (args.skipAssets) {
  checks.push(skipped("asset host checks", "--skip-assets"));
}

if (args.allowTelemetryWrite) {
  checks.push(telemetryCheck(args));
} else {
  checks.push(skipped("POST /api/telemetry synthetic started event", "requires --allow-telemetry-write"));
}

if (args.includeNative) {
  checks.push(...nativeChecks(args));
} else {
  checks.push(skipped("native processor API checks", "requires --include-native"));
}

if (!args.mediaUrl) {
  checks.push(skipped("POST /api/media-fetch public media URL", "requires --media-url"));
}

const results = [];
for (const check of checks) {
  if (check.skipped) {
    results.push(check);
    continue;
  }
  results.push(await requestCheckWithRetry(check, args));
}

const payload = {
  generatedAt: new Date().toISOString(),
  baseUrl: args.baseUrl,
  assetBaseUrl: args.assetBaseUrl,
  summary: {
    passed: results.filter((result) => result.passed && !result.skipped).length,
    failed: results.filter((result) => !result.passed).length,
    skipped: results.filter((result) => result.skipped).length,
  },
  results,
};

if (args.jsonPath) {
  fs.mkdirSync(path.dirname(args.jsonPath), { recursive: true });
  fs.writeFileSync(args.jsonPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${path.relative(repoRoot, args.jsonPath)}`);
}

const markdown = renderReport(payload);
if (args.reportPath) {
  fs.mkdirSync(path.dirname(args.reportPath), { recursive: true });
  fs.writeFileSync(args.reportPath, markdown);
  console.log(`Wrote ${path.relative(repoRoot, args.reportPath)}`);
} else {
  console.log(markdown);
}

if (!args.noFail && payload.summary.failed > 0) {
  process.exit(1);
}

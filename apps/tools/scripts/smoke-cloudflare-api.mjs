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

async function requestCheck(check, args) {
  const startedAt = Date.now();
  try {
    const response = await fetch(check.url, {
      method: check.method ?? "GET",
      body: check.body,
      headers: {
        "user-agent": "tools-serp-cloudflare-api-smoke/1.0",
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
const checks = [...assetChecks(args), ...safeGetChecks(args)];

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
  results.push(await requestCheck(check, args));
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

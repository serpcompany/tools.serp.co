import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  appRoot,
  getWranglerConfig,
  repoRoot,
} from "./lib/cloudflare-audit.mjs";
import { recordRunEvidence } from "../../../scripts/lib/run-evidence.mjs";

const DEFAULT_TIMEOUT_MS = 30000;

function parseArgs(argv) {
  if (argv[0] === "--") {
    argv.shift();
  }

  const wrangler = getWranglerConfig();
  const args = {
    environment: "",
    revision: "",
    baseUrl: process.env.CLOUDFLARE_BASE_URL || "",
    internalToken: process.env.INTERNAL_DASHBOARD_TOKEN || "",
    assetBaseUrl:
      process.env.NEXT_PUBLIC_ASSETS_BASE_URL ||
      wrangler?.vars?.NEXT_PUBLIC_ASSETS_BASE_URL ||
      "https://assets.tools.serp.co",
    mediaUrl: process.env.MEDIA_FETCH_CANARY_URL || "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    allowTelemetryWrite: false,
    includeNative: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--environment") {
      args.environment = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--revision") {
      args.revision = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--base-url") {
      args.baseUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--asset-base-url") {
      args.assetBaseUrl = argv[index + 1] ?? "";
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
    if (arg === "-h" || arg === "--help") {
      console.log(
        [
          "Usage: node scripts/canary-cloudflare-deployed.mjs --environment <preview|production> --base-url <url> --revision <40-character-commit> [options]",
          "",
          "Runs safe reads by default and writes a structured artifact.",
          "",
          "Options:",
          "  --environment <preview|production>  Target environment. Required.",
          "  --base-url <url>                     Deployed HTTPS origin. Required.",
          "  --revision <40-character-commit>     Exact deployed revision. Required.",
          "  --asset-base-url <url>       Asset host for FFmpeg static assets.",
          "  --allow-telemetry-write      POST a synthetic telemetry event.",
          "  --include-native             Exercise native processor APIs.",
          "  --timeout-ms <n>             Per-request timeout. Default 30000.",
          "",
          "Secrets and MEDIA_FETCH_CANARY_URL are accepted only through the environment.",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error("Unknown deployed canary argument");
  }

  if (!args.environment) {
    throw new Error("--environment is required");
  }
  if (!new Set(["preview", "production"]).has(args.environment)) {
    throw new Error("--environment must be preview or production");
  }
  if (!args.baseUrl) {
    throw new Error("--base-url is required");
  }
  if (!/^[a-f0-9]{40}$/.test(args.revision)) {
    throw new Error(
      "--revision requires the full 40-character deployed commit",
    );
  }
  for (const [name, value] of [
    ["--base-url", args.baseUrl],
    ["--asset-base-url", args.assetBaseUrl],
  ]) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be a sanitized HTTPS origin`);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        `${name} must be a sanitized HTTPS origin without a query`,
      );
    }
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

function generatedTranscriptionWorkerChunkPath() {
  const assetsRoot = path.join(appRoot, ".open-next", "assets");
  const chunksRoot = path.join(assetsRoot, "_next", "static", "chunks");
  if (!fs.existsSync(chunksRoot)) {
    throw new Error(
      "Missing generated Cloudflare chunks; run the exact OpenNext build first",
    );
  }
  for (const entry of fs.readdirSync(chunksRoot, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    if (fs.readFileSync(filePath, "utf8").includes("Xenova/whisper-tiny")) {
      return `/${path.relative(assetsRoot, filePath).split(path.sep).join("/")}`;
    }
  }
  throw new Error(
    "Exact OpenNext build is missing the transcription Worker chunk",
  );
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
    expect: (response, bytes) => {
      const contentType = contentTypeEssence(
        response.headers.get("content-type"),
      );
      const expectedType = assetPath.endsWith(".wasm")
        ? "application/wasm"
        : "text/javascript";
      return (
        [200, 206].includes(response.status) &&
        bytes.length > 0 &&
        contentType === expectedType &&
        /(?:^|,)\s*immutable(?:,|$)/i.test(
          response.headers.get("cache-control") ?? "",
        )
      );
    },
    details: (response, bytes) => ({
      contentType: response.headers.get("content-type"),
      contentRange: response.headers.get("content-range"),
      cacheControl: response.headers.get("cache-control"),
      bytes: bytes.length,
    }),
  }));
}

function isolationHeaderChecks(args) {
  const workerChunkPath = generatedTranscriptionWorkerChunkPath();
  return [
    {
      name: `transcription Worker headers ${workerChunkPath}`,
      url: buildUrl(args.baseUrl, workerChunkPath),
      expect: (response, bytes) =>
        response.status === 200 &&
        bytes.length > 0 &&
        contentTypeEssence(response.headers.get("content-type")) ===
          "text/javascript" &&
        response.headers.get("cross-origin-embedder-policy") ===
          "credentialless" &&
        response.headers.get("cross-origin-resource-policy") === "same-origin",
      details: (response, bytes) => ({
        contentType: response.headers.get("content-type"),
        crossOriginEmbedderPolicy: response.headers.get(
          "cross-origin-embedder-policy",
        ),
        crossOriginResourcePolicy: response.headers.get(
          "cross-origin-resource-policy",
        ),
        cacheControl: response.headers.get("cache-control"),
        bytes: bytes.length,
      }),
    },
  ];
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
    const url = new URL(buildUrl(args.baseUrl, "/internal/tools/"));
    url.searchParams.set("token", args.internalToken);
    checks.push({
      name: "GET /internal/tools/ with token",
      url: url.toString(),
      expect: (response, bytes) =>
        response.status === 200 &&
        bytes.includes(Buffer.from("Tools Dashboard")),
      details: (response, bytes) => ({
        contentType: response.headers.get("content-type"),
        bytes: bytes.length,
      }),
    });
  }

  return checks;
}

function telemetryCheck(args) {
  const runId = `cf-canary-${crypto.randomUUID()}`;
  return {
    name: "POST /api/telemetry synthetic started event",
    url: buildUrl(args.baseUrl, "/api/telemetry"),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId,
      toolId: "cloudflare-canary",
      event: "tool_run_started",
      startedAt: new Date().toISOString(),
      metadata: {
        canary: "cloudflare-deployed",
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
      bytes: bytes.length,
    }),
  };
}

function nativeChecks(args) {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.TOOLS_SERP_TEST_CANARY_FAILURE === "native-fixtures"
  ) {
    throw new Error("Injected native fixture failure");
  }
  const checks = [
    {
      name: "POST /api/image-compress?format=svg",
      url: buildUrl(args.baseUrl, "/api/image-compress?format=svg"),
      method: "POST",
      headers: { "content-type": "image/svg+xml" },
      body: readFixture("sample.svg"),
      expect: (response, bytes) =>
        response.status === 200 &&
        contentTypeEssence(response.headers.get("content-type")) ===
          "image/svg+xml" &&
        bytes.length > 0,
    },
    {
      name: "POST /api/image-convert?from=png&to=jpg",
      url: buildUrl(args.baseUrl, "/api/image-convert?from=png&to=jpg"),
      method: "POST",
      headers: { "content-type": "image/png" },
      body: readFixture("sample.png"),
      expect: (response, bytes) =>
        isServerNativeUnavailable(response, bytes, "image-convert"),
    },
    {
      name: "POST /api/video-convert?from=mp4&to=mp3",
      url: buildUrl(args.baseUrl, "/api/video-convert?from=mp4&to=mp3"),
      method: "POST",
      headers: { "content-type": "video/mp4" },
      body: readFixture("sample.mp4"),
      timeoutMs: Math.max(args.timeoutMs, 60000),
      expect: (response, bytes) =>
        isServerNativeUnavailable(response, bytes, "video-convert"),
    },
    {
      name: "POST /api/pdf-compress",
      url: buildUrl(args.baseUrl, "/api/pdf-compress"),
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: readFixture("sample.pdf"),
      timeoutMs: Math.max(args.timeoutMs, 60000),
      expect: (response, bytes) =>
        isServerNativeUnavailable(response, bytes, "pdf-compress"),
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
    }),
  }));
}

function isServerNativeUnavailable(response, bytes, operation) {
  if (
    response.status !== 503 ||
    contentTypeEssence(response.headers.get("content-type")) !==
      "application/json"
  ) {
    return false;
  }
  try {
    const payload = JSON.parse(bytes.toString("utf8"));
    return (
      payload.code === "server-native-unavailable" &&
      typeof payload.error === "string" &&
      payload.capability?.operation === operation &&
      payload.capability?.available === false
    );
  } catch {
    return false;
  }
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
    const status = result.skipped
      ? "skipped"
      : result.passed
        ? "passed"
        : "failed";
    const detail = result.error || JSON.stringify(result.details ?? {});
    return `| ${result.name} | ${status} | ${result.status ?? "-"} | ${result.durationMs} | ${detail.replaceAll("|", "\\|")} |`;
  });

  return [
    "# Deployed Cloudflare Canary Report",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    `- Target environment: ${payload.environment}`,
    `- Deployed revision: ${payload.revision}`,
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

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Deployed canary arguments are invalid",
  );
  process.exit(1);
}
const startedAt = new Date();
const evidenceRepositoryRoot =
  process.env.NODE_ENV === "test" && process.env.TOOLS_SERP_TEST_REPOSITORY_ROOT
    ? path.resolve(process.env.TOOLS_SERP_TEST_REPOSITORY_ROOT)
    : repoRoot;

function recordCanaryEvidence(status, summary, completedAt = new Date()) {
  return recordRunEvidence({
    repositoryRoot: evidenceRepositoryRoot,
    command: "canary:cloudflare:deployed",
    commandVersion: "1",
    revision: args.revision,
    environment: args.environment === "production" ? "main" : "pull-request",
    scope: `cloudflare-${args.environment}`,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    linkedWork: ["#58"],
    summary: {
      status,
      ...summary,
      durationMs: completedAt.valueOf() - startedAt.valueOf(),
    },
  });
}

try {
  const checks = [
    ...assetChecks(args),
    ...isolationHeaderChecks(args),
    ...safeGetChecks(args),
  ];

  if (args.allowTelemetryWrite) {
    checks.push(telemetryCheck(args));
  } else {
    checks.push(
      skipped(
        "POST /api/telemetry synthetic started event",
        "requires --allow-telemetry-write",
      ),
    );
  }

  if (args.includeNative) {
    checks.push(...nativeChecks(args));
  } else {
    checks.push(
      skipped("native processor API checks", "requires --include-native"),
    );
  }

  if (!args.mediaUrl) {
    checks.push(
      skipped(
        "POST /api/media-fetch public media URL",
        "requires MEDIA_FETCH_CANARY_URL",
      ),
    );
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
    environment: args.environment,
    revision: args.revision,
    baseUrl: args.baseUrl,
    assetBaseUrl: args.assetBaseUrl,
    summary: {
      passed: results.filter((result) => result.passed && !result.skipped)
        .length,
      failed: results.filter((result) => !result.passed).length,
      skipped: results.filter((result) => result.skipped).length,
    },
    results,
  };

  const markdown = renderReport(payload);
  console.log(markdown);

  const completedAt = new Date();
  const evidenceStatus = payload.summary.failed > 0 ? "failure" : "success";
  try {
    const evidence = recordCanaryEvidence(
      evidenceStatus,
      {
        checksPassed: payload.summary.passed,
        checksFailed: payload.summary.failed,
        items: results.length,
      },
      completedAt,
    );
    console.log(`Structured artifact: ${evidence.runId}`);
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Structured run artifact could not be recorded",
    );
    process.exitCode = 1;
  }

  if (payload.summary.failed > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  try {
    const evidence = recordCanaryEvidence("failure", {
      checksPassed: 0,
      checksFailed: 1,
      items: 0,
    });
    console.error(`Structured failure artifact: ${evidence.runId}`);
  } catch {
    console.error("Structured canary failure artifact could not be recorded");
  }
  console.error(
    error instanceof Error ? error.message : "Deployed canary failed",
  );
  process.exitCode = 1;
}

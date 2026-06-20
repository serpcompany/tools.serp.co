import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildRouteManifest,
  normalizePathname,
  repoRoot,
  stripTrailingSlash,
} from "./lib/cloudflare-audit.mjs";

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_CONCURRENCY = 6;
const TEXT_CONTENT_TYPES = [
  "text/html",
  "text/plain",
  "application/xml",
  "text/xml",
  "application/json",
];

function parseArgs(argv) {
  if (argv[0] === "--") {
    argv.shift();
  }

  const args = {
    vercelUrl: process.env.VERCEL_BASE_URL || "",
    cloudflareUrl: process.env.CLOUDFLARE_BASE_URL || "",
    internalToken: process.env.INTERNAL_DASHBOARD_TOKEN || "",
    reportPath: "",
    jsonPath: "",
    limit: null,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    includeInternal: false,
    includeNoSlash: false,
    manifestOnly: false,
    noFail: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--vercel-url") {
      args.vercelUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--cloudflare-url") {
      args.cloudflareUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--internal-token") {
      args.internalToken = argv[index + 1] ?? "";
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
    if (arg === "--limit") {
      args.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--concurrency") {
      args.concurrency = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--include-internal") {
      args.includeInternal = true;
      continue;
    }
    if (arg === "--include-noslash") {
      args.includeNoSlash = true;
      continue;
    }
    if (arg === "--manifest-only") {
      args.manifestOnly = true;
      continue;
    }
    if (arg === "--no-fail") {
      args.noFail = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(
        [
          "Usage: node scripts/audit-cloudflare-parity.mjs --vercel-url <url> --cloudflare-url <url> [options]",
          "",
          "Environment fallbacks:",
          "  VERCEL_BASE_URL",
          "  CLOUDFLARE_BASE_URL",
          "  INTERNAL_DASHBOARD_TOKEN",
          "",
          "Options:",
          "  --include-internal      Include /internal/tools/ with token query when a token is supplied.",
          "  --include-noslash       Also test no-trailing-slash redirects for slash routes.",
          "  --limit <n>             Test the first n manifest routes.",
          "  --concurrency <n>       Concurrent route comparisons. Default 6.",
          "  --timeout-ms <n>        Per-request timeout. Default 20000.",
          "  --manifest-only         Print the generated route manifest and exit.",
          "  --report <path>         Write a Markdown report.",
          "  --json <path>           Write raw JSON results.",
          "  --no-fail               Exit 0 even when critical/high mismatches are found.",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 24) {
    throw new Error("--concurrency must be an integer from 1 to 24");
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000");
  }

  return args;
}

function resolveUrl(baseUrl, route, internalToken) {
  const url = new URL(route.path, withTrailingSlash(baseUrl));
  if (route.metadata?.requiresToken && internalToken) {
    url.searchParams.set("token", internalToken);
  }
  return url;
}

function withTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function contentTypeEssence(value) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

function shouldReadBody(contentType) {
  const essence = contentTypeEssence(contentType);
  return TEXT_CONTENT_TYPES.some((candidate) => essence === candidate);
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function extractTag(content, regex) {
  return content.match(regex)?.[1]?.trim() ?? null;
}

function normalizeHtmlText(value) {
  return value?.replace(/\s+/g, " ").trim() ?? null;
}

function extractMarkers(contentType, text) {
  const essence = contentTypeEssence(contentType);
  if (essence !== "text/html") {
    return {
      sha256: text ? digest(text) : null,
    };
  }

  return {
    title: normalizeHtmlText(extractTag(text, /<title[^>]*>([\s\S]*?)<\/title>/i)),
    canonical: extractTag(text, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
    description: extractTag(text, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    robots: extractTag(text, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i),
    h1: normalizeHtmlText(extractTag(text, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, "")),
    sha256: text ? digest(text) : null,
  };
}

function snapshotHeaders(response) {
  return {
    cacheControl: response.headers.get("cache-control"),
    contentType: response.headers.get("content-type"),
    location: response.headers.get("location"),
    xRobotsTag: response.headers.get("x-robots-tag"),
    crossOriginOpenerPolicy: response.headers.get("cross-origin-opener-policy"),
    crossOriginEmbedderPolicy: response.headers.get("cross-origin-embedder-policy"),
  };
}

async function fetchSnapshot(baseUrl, route, args) {
  const url = resolveUrl(baseUrl, route, args.internalToken);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(args.timeoutMs),
      headers: {
        "user-agent": "tools-serp-cloudflare-parity-audit/1.0",
      },
    });
    const headers = snapshotHeaders(response);
    const text = shouldReadBody(headers.contentType) ? await response.text() : "";
    return {
      url: url.toString(),
      status: response.status,
      redirected: [301, 302, 303, 307, 308].includes(response.status),
      headers,
      bodyLength: text.length,
      markers: extractMarkers(headers.contentType, text),
      sanity: bodySanity(route, response.status, headers.contentType, text),
      error: null,
    };
  } catch (error) {
    return {
      url: url.toString(),
      status: null,
      redirected: false,
      headers: {},
      bodyLength: 0,
      markers: {},
      sanity: [],
      error: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

function bodySanity(route, status, contentType, text) {
  const issues = [];
  if (status !== 200) return issues;
  const essence = contentTypeEssence(contentType);
  if (shouldReadBody(contentType) && text.length === 0) {
    issues.push("empty body");
  }
  if (essence === "text/html") {
    if (!/<title[^>]*>[\s\S]+<\/title>/i.test(text)) issues.push("missing title");
    if (!/<main[\s>]/i.test(text) && !/<h1[\s>]/i.test(text)) issues.push("missing main/h1 marker");
  }
  if (route.path.endsWith(".xml") && !/<(urlset|sitemapindex)\b/i.test(text)) {
    issues.push("missing sitemap XML root");
  }
  if (route.path === "/robots.txt" && !/Sitemap:/i.test(text)) {
    issues.push("robots missing Sitemap line");
  }
  if (route.path === "/ads.txt" && !/google\.com,\s*pub-/i.test(text)) {
    issues.push("ads.txt missing google publisher row");
  }
  return issues;
}

function normalizeLocation(location, baseUrl) {
  if (!location) return null;
  try {
    const parsed = new URL(location, withTrailingSlash(baseUrl));
    return normalizePathname(parsed.pathname);
  } catch {
    return location;
  }
}

function compareSnapshots(route, vercel, cloudflare, args) {
  const findings = [];
  const expectedRedirectPath = route.metadata?.expectedRedirectPath
    ? normalizePathname(route.metadata.expectedRedirectPath)
    : null;

  const add = (severity, code, detail) => {
    findings.push({ severity, code, detail });
  };

  if (cloudflare.error) add("critical", "cloudflare_fetch_error", cloudflare.error);
  if (vercel.error) add("high", "vercel_fetch_error", vercel.error);
  if (cloudflare.status === null || vercel.status === null) return findings;

  if (expectedRedirectPath) {
    const cloudflareLocation = normalizeLocation(cloudflare.headers.location, args.cloudflareUrl);
    if (![301, 302, 303, 307, 308].includes(cloudflare.status)) {
      add("high", "cloudflare_redirect_missing", `expected redirect to ${expectedRedirectPath}`);
    } else if (cloudflareLocation !== expectedRedirectPath) {
      add(
        "high",
        "cloudflare_redirect_location_mismatch",
        `expected ${expectedRedirectPath}, got ${cloudflareLocation ?? "no location"}`,
      );
    }
  } else if (vercel.status !== cloudflare.status) {
    const severity = cloudflare.status >= 500 || cloudflare.status === 404 ? "critical" : "high";
    add(severity, "status_mismatch", `Vercel ${vercel.status}, Cloudflare ${cloudflare.status}`);
  }

  if (vercel.status < 400 && cloudflare.status >= 400) {
    add("critical", "cloudflare_regression_status", `Cloudflare returned ${cloudflare.status}`);
  }

  const vercelType = contentTypeEssence(vercel.headers.contentType);
  const cloudflareType = contentTypeEssence(cloudflare.headers.contentType);
  if (vercelType && cloudflareType && vercelType !== cloudflareType) {
    add("high", "content_type_mismatch", `Vercel ${vercelType}, Cloudflare ${cloudflareType}`);
  }

  if (cloudflare.sanity.length) {
    add("critical", "cloudflare_body_sanity", cloudflare.sanity.join("; "));
  }

  if (vercelType === "text/html" && cloudflareType === "text/html") {
    for (const marker of ["title", "canonical", "description", "robots"]) {
      const vercelMarker = vercel.markers[marker] ?? "";
      const cloudflareMarker = cloudflare.markers[marker] ?? "";
      if (vercelMarker !== cloudflareMarker) {
        add("high", `${marker}_mismatch`, `Vercel ${vercelMarker || "-"}, Cloudflare ${cloudflareMarker || "-"}`);
      }
    }
  }

  if (vercel.headers.cacheControl !== cloudflare.headers.cacheControl) {
    add(
      "medium",
      "cache_control_mismatch",
      `Vercel ${vercel.headers.cacheControl ?? "-"}, Cloudflare ${cloudflare.headers.cacheControl ?? "-"}`,
    );
  }

  if (
    vercel.bodyLength > 0 &&
    cloudflare.bodyLength > 0 &&
    (cloudflare.bodyLength < vercel.bodyLength * 0.5 ||
      cloudflare.bodyLength > vercel.bodyLength * 2)
  ) {
    add("medium", "body_length_ratio", `Vercel ${vercel.bodyLength}, Cloudflare ${cloudflare.bodyLength}`);
  }

  if (route.sources.includes("trailing-slash-check")) {
    const expected = normalizePathname(route.metadata.canonicalPath ?? `${stripTrailingSlash(route.path)}/`);
    const location = normalizeLocation(cloudflare.headers.location, args.cloudflareUrl);
    if (![301, 302, 303, 307, 308].includes(cloudflare.status) || location !== expected) {
      add("high", "trailing_slash_redirect_mismatch", `expected ${expected}, got ${location ?? "none"}`);
    }
  }

  return findings;
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function severityCounts(results) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const result of results) {
    for (const finding of result.findings) {
      counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    }
  }
  return counts;
}

function renderReport(payload) {
  const mismatches = payload.results.filter((result) => result.findings.length);
  const topRows = mismatches.slice(0, 100).map((result) => {
    const findingText = result.findings
      .map((finding) => `${finding.severity}:${finding.code} (${finding.detail})`)
      .join("<br>");
    return `| ${result.route.path} | ${result.vercel.status ?? "ERR"} | ${result.cloudflare.status ?? "ERR"} | ${findingText} |`;
  });

  return [
    "# Vercel vs Cloudflare Route Parity Report",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    `- Vercel URL: ${payload.vercelUrl}`,
    `- Cloudflare URL: ${payload.cloudflareUrl}`,
    `- Routes checked: ${payload.results.length}`,
    `- Critical findings: ${payload.counts.critical}`,
    `- High findings: ${payload.counts.high}`,
    `- Medium findings: ${payload.counts.medium}`,
    "",
    "## Mismatches",
    "",
    topRows.length
      ? ["| route | Vercel | Cloudflare | findings |", "| --- | --- | --- | --- |", ...topRows].join("\n")
      : "_No mismatches found._",
    "",
    mismatches.length > topRows.length
      ? `Report truncated to first ${topRows.length} mismatched routes. Use JSON output for complete details.`
      : "",
    "",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
let manifest = buildRouteManifest({
  includeInternal: args.includeInternal && Boolean(args.internalToken),
  includeNoSlash: args.includeNoSlash,
});
if (args.limit !== null) manifest = manifest.slice(0, args.limit);

if (args.manifestOnly) {
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

if (!args.vercelUrl || !args.cloudflareUrl) {
  throw new Error("Both --vercel-url and --cloudflare-url are required for live parity checks.");
}

const results = await mapWithConcurrency(manifest, args.concurrency, async (route, index) => {
  if (index > 0 && index % 100 === 0) {
    console.error(`Checked ${index}/${manifest.length} routes...`);
  }
  const [vercel, cloudflare] = await Promise.all([
    fetchSnapshot(args.vercelUrl, route, args),
    fetchSnapshot(args.cloudflareUrl, route, args),
  ]);
  return {
    route,
    vercel,
    cloudflare,
    findings: compareSnapshots(route, vercel, cloudflare, args),
  };
});

const payload = {
  generatedAt: new Date().toISOString(),
  vercelUrl: args.vercelUrl,
  cloudflareUrl: args.cloudflareUrl,
  counts: severityCounts(results),
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

if (!args.noFail && (payload.counts.critical > 0 || payload.counts.high > 0)) {
  process.exit(1);
}

import fs from "node:fs";
import path from "node:path";
import {
  appRoot,
  buildRouteManifest,
  collectFiles,
  formatBytes,
  getActiveTools,
  getAppSourceCounts,
  getCategoryPaths,
  getGitSnapshot,
  getOperationCounts,
  getPackageScripts,
  getToolsData,
  getVercelProjectMetadata,
  getWranglerConfig,
  repoRoot,
} from "./lib/cloudflare-audit.mjs";

const DEFAULT_REPORT_PATH = path.join(
  repoRoot,
  "docs/audits/vercel-retirement-cloudflare-readiness.md",
);

const CLOUDFLARE_REFERENCE_LINKS = [
  {
    label: "Cloudflare Workers Node.js compatibility",
    url: "https://developers.cloudflare.com/workers/runtime-apis/nodejs/",
    fact: "Cloudflare lists child_process as partially supported and non-functional.",
  },
  {
    label: "Cloudflare Workers process.env behavior",
    url: "https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/",
    fact: "process.env is populated from Worker vars/secrets by default only for compatibility dates on or after 2025-04-01, or with the relevant compatibility flag.",
  },
  {
    label: "Cloudflare Workers limits",
    url: "https://developers.cloudflare.com/workers/platform/limits/",
    fact: "Workers Static Assets have a 25 MiB individual file limit.",
  },
  {
    label: "Cloudflare D1 migrations",
    url: "https://developers.cloudflare.com/d1/reference/migrations/",
    fact: "D1 migrations are versioned SQL files applied through Wrangler.",
  },
  {
    label: "OpenNext Cloudflare caching",
    url: "https://opennext.js.org/cloudflare/caching",
    fact: "OpenNext supports R2 incremental cache with optional regional cache for ISR/SSG and data cache.",
  },
  {
    label: "Cloudflare Workers Logs",
    url: "https://developers.cloudflare.com/workers/observability/logs/workers-logs/",
    fact: "Workers Logs are enabled through the observability configuration.",
  },
  {
    label: "Cloudflare Smart Placement",
    url: "https://developers.cloudflare.com/workers/configuration/placement/",
    fact: "Smart Placement can place a Worker near back-end services based on observed latency.",
  },
];

function parseArgs(argv) {
  if (argv[0] === "--") {
    argv.shift();
  }

  const args = {
    write: false,
    reportPath: DEFAULT_REPORT_PATH,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      args.write = true;
      continue;
    }
    if (arg === "--report") {
      args.write = true;
      args.reportPath = path.resolve(repoRoot, argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(
        [
          "Usage: node scripts/audit-cloudflare-readiness.mjs [options]",
          "",
          "Options:",
          "  --write             Write the Markdown report to docs/audits.",
          "  --report <path>     Write the Markdown report to a custom path.",
          "  --json              Print the raw JSON audit object.",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function scanEnvUsage() {
  const roots = [
    path.join(appRoot, "app"),
    path.join(appRoot, "components"),
    path.join(appRoot, "lib"),
    path.join(appRoot, "scripts"),
    path.join(repoRoot, "packages"),
  ];
  const files = roots.flatMap((root) =>
    collectFiles(root, (filePath) => {
      if (filePath.includes(`${path.sep}public${path.sep}vendor${path.sep}`)) return false;
      if (filePath.includes(`${path.sep}benchmarks${path.sep}fixtures${path.sep}`)) return false;
      return /\.(js|mjs|ts|tsx)$/.test(filePath);
    }),
  );

  const envNames = new Map();
  const dynamicAccess = [];
  const patterns = [
    /process\.env\.([A-Z0-9_]+)/g,
    /process\.env\[['"`]([A-Z0-9_]+)['"`]\]/g,
    /getServerEnv\(['"`]([A-Z0-9_]+)['"`]\)/g,
  ];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const name = match[1];
        const refs = envNames.get(name) ?? [];
        refs.push(path.relative(repoRoot, filePath));
        envNames.set(name, refs);
      }
    }
    if (/process\.env\[[^[\]'"`]/.test(source)) {
      dynamicAccess.push(path.relative(repoRoot, filePath));
    }
  }

  return {
    names: Object.fromEntries(
      Array.from(envNames.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, refs]) => [name, Array.from(new Set(refs)).sort()]),
    ),
    dynamicAccess: Array.from(new Set(dynamicAccess)).sort(),
  };
}

function scanApiRoutes() {
  const apiDir = path.join(appRoot, "app/api");
  const routeFiles = collectFiles(apiDir, (filePath) => filePath.endsWith(`${path.sep}route.ts`));
  const patterns = [
    {
      id: "child_process",
      severity: "blocker",
      regex: /node:child_process|from\s+["']child_process["']|\bspawn\(/,
      reason: "Standard Cloudflare Workers cannot execute native child processes.",
    },
    {
      id: "native_image",
      severity: "blocker",
      regex: /\bsharp\b|\bimagemin\b|\bmagick\b|\bexiftool\b/,
      reason: "Native image tooling or binary execution must be proven outside standard Workers.",
    },
    {
      id: "native_pdf",
      severity: "blocker",
      regex: /ghostscript|qpdf/i,
      reason: "Ghostscript/qpdf style PDF compression requires native runtime support.",
    },
    {
      id: "yt_dlp",
      severity: "blocker",
      regex: /youtube-dl-exec|yt-dlp|YTDLP/i,
      reason: "yt-dlp requires a native executable process.",
    },
    {
      id: "tmp_fs",
      severity: "high",
      regex: /\btmpdir\(|fs\.mkdtemp|fs\.writeFile|fs\.readFile/,
      reason: "Temporary filesystem behavior needs live Worker validation.",
    },
  ];

  return routeFiles.map((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    const route = `/${path
      .relative(path.join(appRoot, "app"), path.dirname(filePath))
      .split(path.sep)
      .join("/")}`;
    const methods = Array.from(source.matchAll(/export\s+(?:async\s+)?function\s+([A-Z]+)/g)).map(
      (match) => match[1],
    );
    const findings = patterns
      .filter((pattern) => pattern.regex.test(source))
      .map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        reason: finding.reason,
      }));

    return {
      route,
      file: path.relative(repoRoot, filePath),
      runtime: /runtime\s*=\s*["']nodejs["']/.test(source) ? "nodejs" : "default",
      methods,
      findings,
    };
  });
}

function scanVendorAssets() {
  const vendorDir = path.join(appRoot, "public/vendor");
  const files = collectFiles(vendorDir, (filePath) => fs.statSync(filePath).isFile());
  return files.map((filePath) => {
    const size = fs.statSync(filePath).size;
    return {
      path: path.relative(appRoot, filePath),
      size,
      sizeLabel: formatBytes(size),
      exceedsWorkersStaticAssetLimit: size > 25 * 1024 * 1024,
    };
  });
}

function getMigrations() {
  const migrationsDir = path.join(appRoot, "migrations");
  return collectFiles(migrationsDir, (filePath) => filePath.endsWith(".sql")).map((filePath) => ({
    path: path.relative(repoRoot, filePath),
    statements: fs
      .readFileSync(filePath, "utf8")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean).length,
  }));
}

function buildAudit() {
  const tools = getToolsData();
  const activeTools = getActiveTools(tools);
  const appSourceCounts = getAppSourceCounts();
  const routeManifest = buildRouteManifest({ includeInternal: true });
  const wrangler = getWranglerConfig();
  const packageInfo = getPackageScripts();
  const vendorAssets = scanVendorAssets();

  return {
    generatedAt: new Date().toISOString(),
    git: getGitSnapshot(),
    vercelProject: getVercelProjectMetadata(),
    wrangler: wrangler
      ? {
          name: wrangler.name,
          main: wrangler.main,
          compatibilityDate: wrangler.compatibility_date,
          compatibilityFlags: wrangler.compatibility_flags ?? [],
          vars: wrangler.vars ?? {},
          d1Databases: (wrangler.d1_databases ?? []).map((database) => ({
            binding: database.binding,
            databaseName: database.database_name,
            databaseId: database.database_id,
            previewDatabaseId: database.preview_database_id,
            migrationsDir: database.migrations_dir,
          })),
          services: wrangler.services ?? [],
          assets: wrangler.assets ?? null,
          r2Buckets: (wrangler.r2_buckets ?? []).map((bucket) => ({
            binding: bucket.binding,
            bucketName: bucket.bucket_name,
            previewBucketName: bucket.preview_bucket_name,
          })),
          observability: wrangler.observability ?? null,
          placement: wrangler.placement ?? null,
          workersDev: wrangler.workers_dev ?? null,
        }
      : null,
    packageInfo,
    routeInventory: {
      toolsTotal: tools.length,
      activeTools: activeTools.length,
      activeRoutes: new Set(activeTools.map((tool) => tool.route)).size,
      operationCounts: getOperationCounts(activeTools),
      ffmpegRequiredTools: activeTools.filter((tool) => tool.requiresFFmpeg).length,
      categoryRoutes: getCategoryPaths(activeTools),
      publicGetRoutesInManifest: routeManifest.filter(
        (route) => !route.metadata?.requiresToken,
      ).length,
      manifestRoutesWithInternal: routeManifest.length,
      appSourceCounts,
    },
    apiRoutes: scanApiRoutes(),
    envUsage: scanEnvUsage(),
    vendorAssets: {
      count: vendorAssets.length,
      overLimit: vendorAssets.filter((asset) => asset.exceedsWorkersStaticAssetLimit),
      ffmpegAssets: vendorAssets.filter((asset) => asset.path.startsWith("public/vendor/ffmpeg")),
    },
    migrations: getMigrations(),
    references: CLOUDFLARE_REFERENCE_LINKS,
  };
}

function markdownTable(headers, rows) {
  if (!rows.length) return "_None._";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function renderMarkdown(audit) {
  const dirtyLine = audit.git.shortStatus
    ? "Worktree has uncommitted changes; this report is tied to the commit plus local diff."
    : "Worktree was clean when this report was generated.";
  const blockerRows = audit.apiRoutes.flatMap((route) =>
    route.findings
      .filter((finding) => finding.severity === "blocker")
      .map((finding) => [route.route, finding.id, finding.reason, route.file]),
  );
  const highRows = audit.apiRoutes.flatMap((route) =>
    route.findings
      .filter((finding) => finding.severity === "high")
      .map((finding) => [route.route, finding.id, finding.reason, route.file]),
  );
  const envRows = Object.entries(audit.envUsage.names).map(([name, refs]) => [
    name,
    refs.slice(0, 4).join("<br>") + (refs.length > 4 ? `<br>+${refs.length - 4} more` : ""),
  ]);
  const scriptRows = [
    ["typecheck", audit.packageInfo.app.typecheck ?? ""],
    ["lint", audit.packageInfo.app.lint ?? ""],
    ["cf:build", audit.packageInfo.app["cf:build"] ?? ""],
    ["migrate:d1:preview:remote", audit.packageInfo.app["migrate:d1:preview:remote"] ?? ""],
    ["migrate:d1:production:remote", audit.packageInfo.app["migrate:d1:production:remote"] ?? ""],
    ["upload:r2:ffmpeg:production", audit.packageInfo.app["upload:r2:ffmpeg:production"] ?? ""],
  ];

  return [
    "# Vercel Retirement / Cloudflare Readiness Audit",
    "",
    `Generated: ${audit.generatedAt}`,
    "",
    "## Baseline",
    "",
    `- Git branch: ${audit.git.branch ?? "unknown"}`,
    `- Git commit: ${audit.git.commit ?? "unknown"}`,
    `- Worktree: ${dirtyLine}`,
    `- Vercel project: ${audit.vercelProject?.projectName ?? "not found locally"}`,
    `- Vercel root directory: ${audit.vercelProject?.rootDirectory ?? "unknown"}`,
    `- Vercel Node version: ${audit.vercelProject?.nodeVersion ?? "unknown"}`,
    `- Cloudflare Worker: ${audit.wrangler?.name ?? "missing wrangler config"}`,
    `- Cloudflare main: ${audit.wrangler?.main ?? "unknown"}`,
    `- Cloudflare compatibility date: ${audit.wrangler?.compatibilityDate ?? "unknown"}`,
    `- Cloudflare compatibility flags: ${(audit.wrangler?.compatibilityFlags ?? []).join(", ") || "none"}`,
    "",
    "## Route Inventory",
    "",
    `- tools.json entries: ${audit.routeInventory.toolsTotal}`,
    `- Active tools: ${audit.routeInventory.activeTools}`,
    `- Unique active tool routes: ${audit.routeInventory.activeRoutes}`,
    `- FFmpeg-required active tools: ${audit.routeInventory.ffmpegRequiredTools}`,
    `- Public GET manifest routes, excluding token-gated dashboard: ${audit.routeInventory.publicGetRoutesInManifest}`,
    `- App Router page/route/layout source files: ${audit.routeInventory.appSourceCounts.sourceFiles}`,
    `- Page files: ${audit.routeInventory.appSourceCounts.pageFiles}`,
    `- Route handler files: ${audit.routeInventory.appSourceCounts.routeFiles}`,
    "",
    markdownTable(
      ["operation", "active tools"],
      Object.entries(audit.routeInventory.operationCounts).map(([operation, count]) => [
        operation,
        String(count),
      ]),
    ),
    "",
    "## Cloudflare Bindings",
    "",
    markdownTable(
      ["type", "name", "details"],
      [
        ...(audit.wrangler?.d1Databases ?? []).map((database) => [
          "D1",
          database.binding,
          `${database.databaseName}; migrations: ${database.migrationsDir}`,
        ]),
        ...(audit.wrangler?.services ?? []).map((service) => [
          "service",
          service.binding,
          service.service,
        ]),
        audit.wrangler?.assets
          ? ["assets", audit.wrangler.assets.binding, audit.wrangler.assets.directory]
          : null,
        ...(audit.wrangler?.r2Buckets ?? []).map((bucket) => [
          "R2",
          bucket.binding,
          [
            bucket.bucketName,
            bucket.previewBucketName ? `preview: ${bucket.previewBucketName}` : null,
          ].filter(Boolean).join("; "),
        ]),
        audit.wrangler?.observability
          ? [
              "observability",
              "Workers Logs",
              `enabled: ${String(Boolean(audit.wrangler.observability.enabled))}; head sampling: ${
                audit.wrangler.observability.head_sampling_rate ?? "default"
              }`,
            ]
          : null,
        audit.wrangler?.placement
          ? ["placement", "Smart Placement", `mode: ${audit.wrangler.placement.mode}`]
          : null,
      ].filter(Boolean),
    ),
    "",
    "## Runtime Risk Findings",
    "",
    "### Blockers",
    "",
    markdownTable(["route", "risk", "reason", "file"], blockerRows),
    "",
    "### High-Risk Validation Items",
    "",
    markdownTable(["route", "risk", "reason", "file"], highRows),
    "",
    "## Environment Inventory",
    "",
    "Runtime, deploy, and audit tooling names are listed here. Secret values are intentionally not read or reported.",
    "",
    markdownTable(["env var", "references"], envRows),
    "",
    audit.envUsage.dynamicAccess.length
      ? `Dynamic process.env access also appears in: ${audit.envUsage.dynamicAccess.join(", ")}`
      : "No dynamic process.env access was detected by the scanner.",
    "",
    "## Assets",
    "",
    `- Vendored public assets scanned: ${audit.vendorAssets.count}`,
    `- Assets over Workers Static Assets 25 MiB limit: ${audit.vendorAssets.overLimit.length}`,
    "",
    markdownTable(
      ["asset", "size"],
      audit.vendorAssets.overLimit.map((asset) => [asset.path, asset.sizeLabel]),
    ),
    "",
    "## D1 Migrations",
    "",
    markdownTable(
      ["migration", "statements"],
      audit.migrations.map((migration) => [migration.path, String(migration.statements)]),
    ),
    "",
    "## Verification Commands",
    "",
    markdownTable(["gate", "command"], scriptRows),
    "",
    "## Current Retirement Gate",
    "",
    "Do not retire Vercel yet. The registry-backed pages and SEO/static routes can be audited for Cloudflare parity, but the native processor API routes remain blocking until they are proven through a retained Node service, Cloudflare Containers, or a Worker-compatible replacement.",
    "",
    "## References",
    "",
    ...audit.references.map((reference) => `- [${reference.label}](${reference.url}) - ${reference.fact}`),
    "",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
const audit = buildAudit();

if (args.json) {
  console.log(JSON.stringify(audit, null, 2));
} else {
  const report = renderMarkdown(audit);
  if (args.write) {
    fs.mkdirSync(path.dirname(args.reportPath), { recursive: true });
    fs.writeFileSync(args.reportPath, report);
    console.log(`Wrote ${path.relative(repoRoot, args.reportPath)}`);
  } else {
    console.log(report);
  }
}

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeCloudflareBuildProvenance } from "./lib/cloudflare-build-provenance.mjs";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(appRoot, "../..");

const defaultAssetsBaseUrl = "https://assets.tools.serp.co";
const defaultSiteUrl = "https://tools.serp.co";
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_ASSETS_BASE_URL:
    process.env.NEXT_PUBLIC_ASSETS_BASE_URL || defaultAssetsBaseUrl,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || defaultSiteUrl,
};

console.log(
  [
    `Building Cloudflare bundle with NEXT_PUBLIC_ASSETS_BASE_URL=${env.NEXT_PUBLIC_ASSETS_BASE_URL}`,
    `NEXT_PUBLIC_SITE_URL=${env.NEXT_PUBLIC_SITE_URL}`,
  ].join(" "),
);

const buildResult = spawnSync("opennextjs-cloudflare", ["build"], {
  env,
  stdio: "inherit",
});

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const prepareAssetsResult = spawnSync(
  process.execPath,
  ["scripts/prepare-workers-assets.mjs"],
  {
    env,
    stdio: "inherit",
  },
);

if (prepareAssetsResult.status !== 0) {
  process.exit(prepareAssetsResult.status ?? 1);
}

const patchWorkerResult = spawnSync(
  process.execPath,
  ["scripts/patch-cloudflare-worker-assets.mjs"],
  { env, stdio: "inherit" },
);

if (patchWorkerResult.status !== 0) {
  process.exit(patchWorkerResult.status ?? 1);
}

const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const clean =
  execFileSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim() === "";
writeCloudflareBuildProvenance({ appRoot, revision, clean });

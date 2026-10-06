import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { getBuildEnvironmentError } from "./lib/build-environment.mjs";

const defaultAssetsBaseUrl = "https://assets.tools.serp.co";
const defaultSiteUrl = "https://tools.serp.co";
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_ASSETS_BASE_URL:
    process.env.NEXT_PUBLIC_ASSETS_BASE_URL || defaultAssetsBaseUrl,
  NEXT_PUBLIC_SITE_URL:
    process.env.NEXT_PUBLIC_SITE_URL || defaultSiteUrl,
  // The release id stamped on telemetry: Workers Builds' commit, else the
  // local checkout's.
  NEXT_PUBLIC_RELEASE:
    process.env.NEXT_PUBLIC_RELEASE ||
    process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 12) ||
    spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).stdout?.trim() ||
    "unknown",
};

const buildEnvironmentError = getBuildEnvironmentError(env);
if (buildEnvironmentError) {
  console.error(buildEnvironmentError);
  process.exit(1);
}

console.log(
  [
    `Building Cloudflare bundle with NEXT_PUBLIC_ASSETS_BASE_URL=${env.NEXT_PUBLIC_ASSETS_BASE_URL}`,
    `NEXT_PUBLIC_SITE_URL=${env.NEXT_PUBLIC_SITE_URL}`,
    // Unset means non-production: noindex, no analytics or ads.
    `NEXT_PUBLIC_SITE_ENV=${env.NEXT_PUBLIC_SITE_ENV ?? "(unset)"}`,
  ].join(" "),
);

const buildResult = spawnSync("opennextjs-cloudflare", ["build"], {
  env,
  stdio: "inherit",
});

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

// The Worker entry (sentry-worker.mjs) tags error reports with this release.
writeFileSync(
  ".open-next/release.mjs",
  `export default ${JSON.stringify(env.NEXT_PUBLIC_RELEASE)};\n`,
);

const prepareAssetsResult = spawnSync(
  process.execPath,
  ["scripts/prepare-workers-assets.mjs"],
  {
    env,
    stdio: "inherit",
  },
);

process.exit(prepareAssetsResult.status ?? 1);

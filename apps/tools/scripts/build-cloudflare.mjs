import { spawnSync } from "node:child_process";

const defaultAssetsBaseUrl = "https://assets.tools.serp.co";
const defaultSiteUrl = "https://tools.serp.co";
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_ASSETS_BASE_URL:
    process.env.NEXT_PUBLIC_ASSETS_BASE_URL || defaultAssetsBaseUrl,
  NEXT_PUBLIC_SITE_URL:
    process.env.NEXT_PUBLIC_SITE_URL || defaultSiteUrl,
};

// Workers Builds must say which environment it builds; an unset value would
// ship a non-production (noindex, no analytics) build without any error.
if (process.env.WORKERS_CI && !env.NEXT_PUBLIC_SITE_ENV) {
  console.error("NEXT_PUBLIC_SITE_ENV is unset. Build with cf:build:production or cf:build:staging.");
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

const prepareAssetsResult = spawnSync(
  process.execPath,
  ["scripts/prepare-workers-assets.mjs"],
  {
    env,
    stdio: "inherit",
  },
);

process.exit(prepareAssetsResult.status ?? 1);

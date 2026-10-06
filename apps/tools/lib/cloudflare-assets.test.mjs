import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const wranglerConfigSource = readFileSync(
  new URL("../wrangler.jsonc", import.meta.url),
  "utf8",
);
const videoConvertSource = readFileSync(
  new URL("../lib/convert/video.ts", import.meta.url),
  "utf8",
);
const prepareWorkersAssetsSource = readFileSync(
  new URL("../scripts/prepare-workers-assets.mjs", import.meta.url),
  "utf8",
);
const buildCloudflareSource = readFileSync(
  new URL("../scripts/build-cloudflare.mjs", import.meta.url),
  "utf8",
);
const uploadR2AssetsSource = readFileSync(
  new URL("../scripts/upload-r2-ffmpeg-assets.mjs", import.meta.url),
  "utf8",
);

test("Cloudflare builds externalize oversized ffmpeg assets to the public asset host", () => {
  assert.match(videoConvertSource, /NEXT_PUBLIC_ASSETS_BASE_URL/);
  assert.ok(
    videoConvertSource.includes('replace(/\\/+$/, "")'),
    "asset base URL should strip trailing slashes",
  );
  assert.match(videoConvertSource, /resolvePublicAssetPath/);
  assert.match(videoConvertSource, /\/vendor\/ffmpeg-st/);
  assert.match(videoConvertSource, /\/vendor\/ffmpeg/);
  assert.match(wranglerConfigSource, /NEXT_PUBLIC_ASSETS_BASE_URL/);
  assert.match(wranglerConfigSource, /https:\/\/assets\.tools\.serp\.co/);
});

test("Workers static asset bundle excludes ffmpeg files that exceed Cloudflare limits", () => {
  assert.match(packageJson.scripts["cf:build"], /build-cloudflare\.mjs/);
  assert.match(packageJson.scripts["cf:preview"], /wrangler dev/);
  assert.match(packageJson.scripts["deploy:staging"], /wrangler deploy --env staging/);
  assert.match(packageJson.scripts["deploy:production"], /wrangler deploy --env production/);
  assert.match(buildCloudflareSource, /opennextjs-cloudflare/);
  assert.match(buildCloudflareSource, /prepare-workers-assets\.mjs/);
  assert.match(buildCloudflareSource, /NEXT_PUBLIC_ASSETS_BASE_URL/);
  assert.match(buildCloudflareSource, /https:\/\/assets\.tools\.serp\.co/);
  assert.match(prepareWorkersAssetsSource, /\.assetsignore/);
  assert.match(prepareWorkersAssetsSource, /\/vendor\/ffmpeg\/\*\*/);
  assert.match(prepareWorkersAssetsSource, /\/vendor\/ffmpeg-st\/\*\*/);
});

test("ffmpeg R2 upload helper publishes the same public paths used by the app", () => {
  assert.match(packageJson.scripts["r2:upload-ffmpeg-assets"], /upload-r2-ffmpeg-assets\.mjs/);
  assert.match(uploadR2AssetsSource, /tools-serp-co-assets/);
  assert.match(uploadR2AssetsSource, /"--remote"/);
  assert.match(uploadR2AssetsSource, /public[\s\S]*vendor[\s\S]*ffmpeg/);
  assert.match(uploadR2AssetsSource, /public[\s\S]*vendor[\s\S]*ffmpeg-st/);
  assert.match(uploadR2AssetsSource, /path\.relative\(path\.join\(appRoot, "public"\), filePath\)/);
  assert.match(uploadR2AssetsSource, /args\.shift\(\)/);
  assert.match(uploadR2AssetsSource, /application\/wasm/);
  assert.match(uploadR2AssetsSource, /public, max-age=31536000, immutable/);
});

import fs from "node:fs";
import path from "node:path";

const outputDir = path.join(process.cwd(), ".open-next", "assets");

if (!fs.existsSync(outputDir)) {
  console.error("Missing build output at .open-next/assets. Run pnpm cf:build first.");
  process.exit(1);
}

const assetsIgnorePath = path.join(outputDir, ".assetsignore");
const ignoreLines = [
  // These FFmpeg WASM files exceed Workers Static Assets' 25 MiB per-file limit.
  // They are served from R2 through NEXT_PUBLIC_ASSETS_BASE_URL instead.
  "/vendor/ffmpeg/**",
  "/vendor/ffmpeg-st/**",
];

fs.writeFileSync(assetsIgnorePath, `${ignoreLines.join("\n")}\n`);

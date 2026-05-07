import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultSourcePath = resolve(
  repoRoot,
  "../serp/docs/network-brands/network-brands.json",
);
const sourcePath = resolve(
  process.argv[2] ?? process.env.NETWORK_BRANDS_SOURCE ?? defaultSourcePath,
);
const destinationPath = resolve(
  repoRoot,
  "packages/app-core/src/data/network-brands.json",
);

await mkdir(dirname(destinationPath), { recursive: true });
await copyFile(sourcePath, destinationPath);

console.log(`Synced network brands from ${sourcePath} to ${destinationPath}`);

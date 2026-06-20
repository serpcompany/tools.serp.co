import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const appRoot = process.cwd();
const wranglerBin = path.join(appRoot, "node_modules", ".bin", "wrangler");
const defaultBucket = process.env.R2_ASSETS_BUCKET || "tools-serp-co-assets";

const usage = `Usage: node scripts/upload-r2-ffmpeg-assets.mjs [options]

Uploads public/vendor/ffmpeg* assets to an R2 bucket using their public paths.

Options:
  --bucket <name>   R2 bucket name (default: R2_ASSETS_BUCKET or ${defaultBucket})
  --dry-run         Print upload commands without writing to R2
  -h, --help        Show this help
`;

const args = process.argv.slice(2);
if (args[0] === "--") {
  args.shift();
}
let bucket = defaultBucket;
let dryRun = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--bucket") {
    const nextValue = args[index + 1];
    if (!nextValue) {
      console.error("--bucket requires a value.");
      process.exit(1);
    }
    bucket = nextValue;
    index += 1;
  } else if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "-h" || arg === "--help") {
    console.log(usage);
    process.exit(0);
  } else {
    console.error(`Unknown option: ${arg}`);
    console.error(usage);
    process.exit(1);
  }
}

const sourceDirs = [
  path.join(appRoot, "public", "vendor", "ffmpeg"),
  path.join(appRoot, "public", "vendor", "ffmpeg-st"),
];

const contentTypes = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

function collectFiles(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Missing asset directory: ${path.relative(appRoot, dir)}`);
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name));
}

function uploadObject(filePath, key) {
  const extension = path.extname(filePath);
  const contentType = contentTypes.get(extension) || "application/octet-stream";
  const wranglerArgs = [
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--remote",
    "--file",
    filePath,
    "--content-type",
    contentType,
    "--cache-control",
    "public, max-age=31536000, immutable",
  ];

  if (dryRun) {
    console.log(`${wranglerBin} ${wranglerArgs.join(" ")}`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(wranglerBin, wranglerArgs, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`wrangler exited with code ${code}`));
    });
  });
}

const files = sourceDirs.flatMap(collectFiles);

console.log(
  `${dryRun ? "Would upload" : "Uploading"} ${files.length} FFmpeg assets to R2 bucket ${bucket}.`
);

for (const filePath of files) {
  const key = path.relative(path.join(appRoot, "public"), filePath).split(path.sep).join("/");
  await uploadObject(filePath, key);
}

console.log(dryRun ? "Dry run complete." : "R2 FFmpeg asset upload complete.");

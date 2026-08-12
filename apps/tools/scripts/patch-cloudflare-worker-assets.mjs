import fs from "node:fs";
import path from "node:path";

const FETCH_ENTRY = "    async fetch(request, env, ctx) {\n";
const ASSET_ADAPTER = `        const assetUrl = new URL(request.url);
        if (assetUrl.pathname.startsWith("/_next/static/chunks/") && assetUrl.pathname.endsWith(".js")) {
            const assetResponse = await env.ASSETS.fetch(request);
            const assetHeaders = new Headers(assetResponse.headers);
            assetHeaders.set("Cross-Origin-Embedder-Policy", "credentialless");
            assetHeaders.set("Cross-Origin-Resource-Policy", "same-origin");
            return new Response(assetResponse.body, {
                status: assetResponse.status,
                statusText: assetResponse.statusText,
                headers: assetHeaders,
            });
        }
`;

export function addIsolatedAssetAdapter(source) {
  if (source.includes(ASSET_ADAPTER)) return source;
  const matches = source.split(FETCH_ENTRY).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected one OpenNext fetch entry; found ${matches}`);
  }
  return source.replace(FETCH_ENTRY, `${FETCH_ENTRY}${ASSET_ADAPTER}`);
}

function javascriptFiles(directory) {
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

export function verifyCloudflareIsolationBuild({ workerSource, assetsDirectory }) {
  for (const expected of [
    'assetUrl.pathname.startsWith("/_next/static/chunks/")',
    'assetUrl.pathname.endsWith(".js")',
    'assetHeaders.set("Cross-Origin-Embedder-Policy", "credentialless")',
    'assetHeaders.set("Cross-Origin-Resource-Policy", "same-origin")',
  ]) {
    if (!workerSource.includes(expected)) {
      throw new Error(`Generated Worker is missing isolation adapter: ${expected}`);
    }
  }

  const chunksDirectory = path.join(
    assetsDirectory,
    "_next",
    "static",
    "chunks",
  );
  const chunks = javascriptFiles(chunksDirectory);
  if (!chunks.some((file) => fs.readFileSync(file, "utf8").includes("Xenova/whisper-tiny"))) {
    throw new Error("Generated assets are missing the transcription Worker chunk");
  }
  const ffmpegBundle = chunks.find((file) => {
    const source = fs.readFileSync(file, "utf8");
    return (
      source.includes("https://assets.tools.serp.co") &&
      source.includes("ffmpeg-core.js") &&
      source.includes("ffmpeg-core.wasm")
    );
  });
  if (!ffmpegBundle) {
    throw new Error(
      "Generated assets do not externalize the required FFmpeg core and WASM resources",
    );
  }
}

const workerPath = path.join(process.cwd(), ".open-next", "worker.js");
if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (!fs.existsSync(workerPath)) {
    throw new Error("Missing .open-next/worker.js; run the OpenNext build first");
  }
  fs.writeFileSync(
    workerPath,
    addIsolatedAssetAdapter(fs.readFileSync(workerPath, "utf8")),
  );
  verifyCloudflareIsolationBuild({
    workerSource: fs.readFileSync(workerPath, "utf8"),
    assetsDirectory: path.join(process.cwd(), ".open-next", "assets"),
  });
}

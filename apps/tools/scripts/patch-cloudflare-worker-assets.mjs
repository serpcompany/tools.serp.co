import fs from "node:fs";
import path from "node:path";
import {
  TRANSCRIPTION_MODEL_FILES,
  transcriptionModelAssetPath,
  transcriptionModelUpstreamUrl,
} from "../lib/transcription-model-assets.js";

const FETCH_ENTRY = "    async fetch(request, env, ctx) {\n";
const modelProxyEntries = TRANSCRIPTION_MODEL_FILES.map(
  (file) =>
    `            [${JSON.stringify(transcriptionModelAssetPath(file))}, ${JSON.stringify(transcriptionModelUpstreamUrl(file))}],`,
).join("\n");

const ASSET_ADAPTER = `        const assetUrl = new URL(request.url);
        const proxiedAssetTargets = new Map([
            ["/vendor/ffmpeg/ffmpeg-core.js", "/vendor/ffmpeg/ffmpeg-core.js"],
            ["/vendor/ffmpeg/ffmpeg-core.wasm", "/vendor/ffmpeg/ffmpeg-core.wasm"],
            ["/vendor/ffmpeg/ffmpeg-core.worker.js", "/vendor/ffmpeg/ffmpeg-core.worker.js"],
            ["/vendor/ffmpeg-st/ffmpeg-core.js", "/vendor/ffmpeg-st/ffmpeg-core.js"],
            ["/vendor/ffmpeg-st/ffmpeg-core.wasm", "/vendor/ffmpeg-st/ffmpeg-core.wasm"],
${modelProxyEntries}
        ]);
        const mappedAssetTarget = proxiedAssetTargets.get(assetUrl.pathname);
        if (mappedAssetTarget) {
            const isTranscriptionModelAsset = assetUrl.pathname.startsWith("/vendor/models/whisper-tiny/");
            const modelFailureResponse = (status = 502) => new Response("Model asset upstream request failed", {
                status: status >= 400 && status <= 599 ? status : 502,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-store",
                    "Content-Type": "text/plain;charset=UTF-8",
                    "Cross-Origin-Resource-Policy": "same-origin",
                },
            });
            if (request.method !== "GET" && request.method !== "HEAD") {
                return new Response("Method Not Allowed", {
                    status: 405,
                    headers: { Allow: "GET, HEAD" },
                });
            }
            const upstreamRequestHeaders = new Headers();
            for (const headerName of ["Range", "If-Range", "If-None-Match", "If-Modified-Since"]) {
                const headerValue = request.headers.get(headerName);
                if (headerValue !== null) upstreamRequestHeaders.set(headerName, headerValue);
            }
            const proxiedAssetTarget = mappedAssetTarget.startsWith("https://")
                ? mappedAssetTarget
                : new URL(mappedAssetTarget, env.NEXT_PUBLIC_ASSETS_BASE_URL).toString();
            let upstreamResponse;
            try {
                upstreamResponse = await fetch(proxiedAssetTarget, {
                    method: request.method,
                    headers: upstreamRequestHeaders,
                    redirect: "follow",
                });
            } catch (error) {
                if (isTranscriptionModelAsset) return modelFailureResponse();
                throw error;
            }
            if (isTranscriptionModelAsset && ![200, 206, 304].includes(upstreamResponse.status)) {
                return modelFailureResponse(upstreamResponse.status);
            }
            const upstreamHeaders = new Headers();
            for (const headerName of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control", "ETag", "Last-Modified"]) {
                const headerValue = upstreamResponse.headers.get(headerName);
                if (headerValue !== null) upstreamHeaders.set(headerName, headerValue);
            }
            upstreamHeaders.set("Access-Control-Allow-Origin", "*");
            upstreamHeaders.set("Cross-Origin-Resource-Policy", "same-origin");
            if (isTranscriptionModelAsset && upstreamResponse.status !== 304) {
                upstreamHeaders.set("Cache-Control", "public,max-age=31536000,immutable");
                upstreamHeaders.set("Content-Type", assetUrl.pathname.endsWith(".json") ? "application/json" : "application/octet-stream");
            }
            if (isTranscriptionModelAsset && upstreamResponse.status === 304) {
                upstreamHeaders.delete("Content-Type");
                upstreamHeaders.delete("Content-Length");
                upstreamHeaders.delete("Content-Range");
            }
            return new Response(upstreamResponse.body, {
                status: upstreamResponse.status,
                statusText: upstreamResponse.statusText,
                headers: upstreamHeaders,
            });
        }
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
    'proxiedAssetTargets.get(assetUrl.pathname)',
    'https://huggingface.co/Xenova/whisper-tiny/resolve/',
    'const upstreamRequestHeaders = new Headers()',
    'const upstreamHeaders = new Headers()',
    'upstreamHeaders.set("Access-Control-Allow-Origin", "*")',
    'upstreamHeaders.set("Cross-Origin-Resource-Policy", "same-origin")',
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
      source.includes("/vendor/ffmpeg") &&
      source.includes("ffmpeg-core.js") &&
      source.includes("ffmpeg-core.wasm")
    );
  });
  if (!ffmpegBundle) {
    throw new Error(
      "Generated assets do not reference the app-owned FFmpeg core and WASM paths",
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

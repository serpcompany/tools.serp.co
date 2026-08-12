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

const workerPath = path.join(process.cwd(), ".open-next", "worker.js");
if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (!fs.existsSync(workerPath)) {
    throw new Error("Missing .open-next/worker.js; run the OpenNext build first");
  }
  fs.writeFileSync(
    workerPath,
    addIsolatedAssetAdapter(fs.readFileSync(workerPath, "utf8")),
  );
}

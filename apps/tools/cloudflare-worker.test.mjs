import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { addIsolatedAssetAdapter } from "./scripts/patch-cloudflare-worker-assets.mjs";

const wranglerSource = readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");

test("Cloudflare routes generated worker chunks through the header-owning Worker adapter", () => {
  assert.match(wranglerSource, /"main":\s*"\.open-next\/worker\.js"/);
  assert.match(wranglerSource, /"run_worker_first":\s*\[\s*"\/_next\/static\/chunks\/\*"\s*\]/);
});

test("OpenNext post-build adapter owns generated worker chunk headers", () => {
  const generated = `export default {\n    async fetch(request, env, ctx) {\n        return handle(request, env, ctx);\n    },\n};\n`;
  const patched = addIsolatedAssetAdapter(generated);
  assert.match(patched, /env\.ASSETS\.fetch\(request\)/);
  assert.match(patched, /Cross-Origin-Embedder-Policy", "credentialless/);
  assert.match(patched, /Cross-Origin-Resource-Policy", "same-origin/);
  assert.match(patched, /return handle\(request, env, ctx\)/);
  assert.equal(addIsolatedAssetAdapter(patched), patched);
});

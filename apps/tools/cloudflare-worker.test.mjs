import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addIsolatedAssetAdapter,
  verifyCloudflareIsolationBuild,
} from "./scripts/patch-cloudflare-worker-assets.mjs";

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

test("Cloudflare build verification covers emitted transcription and FFmpeg resources", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "tools-isolation-build-"));
  t.after(() => rmSync(root, { recursive: true }));
  const chunks = path.join(root, "_next", "static", "chunks");
  mkdirSync(chunks, { recursive: true });
  writeFileSync(path.join(chunks, "transcribe.js"), '"Xenova/whisper-tiny"');
  writeFileSync(
    path.join(chunks, "ffmpeg.js"),
    '"https://assets.tools.serp.co";"ffmpeg-core.js";"ffmpeg-core.wasm"',
  );
  const workerSource = addIsolatedAssetAdapter(
    `export default {\n    async fetch(request, env, ctx) {\n        return handle(request, env, ctx);\n    },\n};\n`,
  );

  assert.doesNotThrow(() =>
    verifyCloudflareIsolationBuild({
      workerSource,
      assetsDirectory: root,
    }),
  );
});

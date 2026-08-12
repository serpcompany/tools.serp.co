import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import {
  addIsolatedAssetAdapter,
  verifyCloudflareIsolationBuild,
} from "./scripts/patch-cloudflare-worker-assets.mjs";

const wranglerSource = readFileSync(
  new URL("./wrangler.jsonc", import.meta.url),
  "utf8",
);
const buildSource = readFileSync(
  new URL("./scripts/build-cloudflare.mjs", import.meta.url),
  "utf8",
);

test("Cloudflare routes generated worker chunks through the header-owning Worker adapter", () => {
  assert.match(wranglerSource, /"main":\s*"\.open-next\/worker\.js"/);
  assert.match(
    wranglerSource,
    /"run_worker_first":\s*\[\s*"\/_next\/static\/chunks\/\*"/,
  );
  assert.match(wranglerSource, /"\/vendor\/ffmpeg\/\*"/);
  assert.match(wranglerSource, /"\/vendor\/ffmpeg-st\/\*"/);
  assert.match(wranglerSource, /"\/vendor\/models\/whisper-tiny\//);
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

test(
  "an isolated browser can fetch FFmpeg WASM through the same-origin Worker proxy",
  { timeout: 15_000 },
  async (t) => {
    const wasm = Buffer.from([0, 97, 115, 109]);
    const upstreamRequests = [];
    const upstream = http.createServer((request, response) => {
      upstreamRequests.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        internal: request.headers["x-internal-secret"],
        ifNoneMatch: request.headers["if-none-match"],
        range: request.headers.range,
        url: request.url,
      });
      response.writeHead(200, {
        "cache-control": "public,max-age=31536000,immutable",
        "content-type": "application/wasm",
        etag: '"ffmpeg-fixture"',
        "set-cookie": "upstream-session=owned; Path=/; HttpOnly",
        "x-upstream-secret": "must-not-cross-app-origin",
      });
      response.end(wasm);
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => upstream.close());
    const upstreamAddress = upstream.address();
    assert.ok(upstreamAddress && typeof upstreamAddress !== "string");

    const generated = `export default {\n    async fetch(request, env, ctx) {\n        return new Response("<!doctype html><title>isolated</title>", { headers: { "content-type": "text/html", "cross-origin-embedder-policy": "credentialless", "cross-origin-opener-policy": "same-origin" } });\n    },\n};\n`;
    const patched = addIsolatedAssetAdapter(generated);
    const worker = (
      await import(`data:text/javascript;base64,${Buffer.from(patched).toString("base64")}`)
    ).default;
    const app = http.createServer(async (request, response) => {
      const address = app.address();
      assert.ok(address && typeof address !== "string");
      const workerResponse = await worker.fetch(
        new Request(`http://127.0.0.1:${address.port}${request.url}`, {
          headers: {
            ...request.headers,
            authorization: "Bearer private-app-token",
            cookie: "session=private-app-session",
            "if-none-match": '"browser-cache"',
            range: "bytes=0-3",
            "x-internal-secret": "private-app-header",
          },
          method: request.method,
        }),
        {
          NEXT_PUBLIC_ASSETS_BASE_URL: `http://127.0.0.1:${upstreamAddress.port}`,
        },
        {},
      );
      response.writeHead(
        workerResponse.status,
        Object.fromEntries(workerResponse.headers),
      );
      response.end(Buffer.from(await workerResponse.arrayBuffer()));
    });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    t.after(() => app.close());
    const appAddress = app.address();
    assert.ok(appAddress && typeof appAddress !== "string");

    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const failures = [];
    page.on("requestfailed", (request) => failures.push(request.failure()?.errorText));
    await page.goto(`http://127.0.0.1:${appAddress.port}/`);
    const result = await page.evaluate(async () => {
      const response = await fetch("/vendor/ffmpeg-st/ffmpeg-core.wasm");
      return {
        bytes: [...new Uint8Array(await response.arrayBuffer())],
        contentType: response.headers.get("content-type"),
        cors: response.headers.get("access-control-allow-origin"),
        corp: response.headers.get("cross-origin-resource-policy"),
        etag: response.headers.get("etag"),
        setCookie: response.headers.get("set-cookie"),
        status: response.status,
        upstreamSecret: response.headers.get("x-upstream-secret"),
      };
    });
    const appCookies = await page.context().cookies(
      `http://127.0.0.1:${appAddress.port}`,
    );

    assert.deepEqual(result, {
      bytes: [...wasm],
      contentType: "application/wasm",
      cors: "*",
      corp: "same-origin",
      etag: '"ffmpeg-fixture"',
      setCookie: null,
      status: 200,
      upstreamSecret: null,
    });
    assert.deepEqual(upstreamRequests, [
      {
        authorization: undefined,
        cookie: undefined,
        internal: undefined,
        ifNoneMatch: '"browser-cache"',
        range: "bytes=0-3",
        url: "/vendor/ffmpeg-st/ffmpeg-core.wasm",
      },
    ]);
    assert.deepEqual(failures, []);
    assert.deepEqual(
      appCookies.filter((cookie) => cookie.name === "upstream-session"),
      [],
    );
  },
);

test(
  "an isolated browser can fetch only pinned Whisper resources without crossing private headers",
  { timeout: 15_000 },
  async (t) => {
    const revision = "5332fcc35e32a33b86612b9a57a89be7906102b1";
    const assetPath = `/vendor/models/whisper-tiny/${revision}/config.json`;
    const originalFetch = globalThis.fetch;
    const upstreamRequests = [];
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      upstreamRequests.push({
        authorization: request.headers.get("authorization"),
        cookie: request.headers.get("cookie"),
        internal: request.headers.get("x-internal-secret"),
        range: request.headers.get("range"),
        url: request.url,
      });
      return new Response('{"model_type":"whisper"}', {
        headers: {
          "content-type": "text/plain",
          etag: '"pinned-model-fixture"',
          "set-cookie": "model-session=owned; Path=/; HttpOnly",
          "x-upstream-secret": "must-not-cross-app-origin",
        },
      });
    };
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    const generated = `export default {\n    async fetch(request, env, ctx) {\n        return new Response("<!doctype html><title>isolated</title>", { headers: { "content-type": "text/html", "cross-origin-embedder-policy": "credentialless", "cross-origin-opener-policy": "same-origin" } });\n    },\n};\n`;
    const worker = (
      await import(`data:text/javascript;base64,${Buffer.from(addIsolatedAssetAdapter(generated)).toString("base64")}`)
    ).default;
    const app = http.createServer(async (request, response) => {
      const address = app.address();
      assert.ok(address && typeof address !== "string");
      const workerResponse = await worker.fetch(
        new Request(`http://127.0.0.1:${address.port}${request.url}`, {
          headers: {
            authorization: "Bearer private-app-token",
            cookie: "session=private-app-session",
            range: "bytes=0-63",
            "x-internal-secret": "private-app-header",
          },
          method: request.method,
        }),
        {},
        {},
      );
      response.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers));
      response.end(Buffer.from(await workerResponse.arrayBuffer()));
    });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    t.after(() => app.close());
    const address = app.address();
    assert.ok(address && typeof address !== "string");

    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const failures = [];
    page.on("requestfailed", (request) => failures.push(request.failure()?.errorText));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const result = await page.evaluate(async (path) => {
      const response = await fetch(path);
      return {
        body: await response.json(),
        cacheControl: response.headers.get("cache-control"),
        contentType: response.headers.get("content-type"),
        cors: response.headers.get("access-control-allow-origin"),
        corp: response.headers.get("cross-origin-resource-policy"),
        upstreamSecret: response.headers.get("x-upstream-secret"),
      };
    }, assetPath);
    const deniedResponse = await page.evaluate(async (path) => {
      const response = await fetch(path.replace("config.json", "README.md"));
      return {
        contentType: response.headers.get("content-type"),
        text: await response.text(),
      };
    }, assetPath);
    const cookies = await page.context().cookies(`http://127.0.0.1:${address.port}`);

    assert.deepEqual(result, {
      body: { model_type: "whisper" },
      cacheControl: "public,max-age=31536000,immutable",
      contentType: "application/json",
      cors: "*",
      corp: "same-origin",
      upstreamSecret: null,
    });
    assert.deepEqual(upstreamRequests, [{
      authorization: null,
      cookie: null,
      internal: null,
      range: "bytes=0-63",
      url: `https://huggingface.co/Xenova/whisper-tiny/resolve/${revision}/config.json`,
    }]);
    assert.match(deniedResponse.contentType ?? "", /^text\/html/);
    assert.match(deniedResponse.text, /<title>isolated<\/title>/);
    assert.deepEqual(cookies.filter((cookie) => cookie.name === "model-session"), []);
    assert.deepEqual(failures, []);
  },
);

for (const upstreamStatus of [404, 429, 500]) {
  test(`Whisper proxy converts upstream ${upstreamStatus} into a non-cacheable bounded error`, async (t) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("upstream body must not cross the app origin", {
        status: upstreamStatus,
        headers: {
          "cache-control": "public,max-age=31536000,immutable",
          "content-type": "application/octet-stream",
          "set-cookie": "model-error=owned; Path=/; HttpOnly",
          "x-upstream-secret": "must-not-cross-app-origin",
        },
      });
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    const generated = `export default {\n    async fetch(request, env, ctx) {\n        return new Response("fallback");\n    },\n};\n`;
    const worker = (
      await import(`data:text/javascript;base64,${Buffer.from(addIsolatedAssetAdapter(generated)).toString("base64")}`)
    ).default;
    const response = await worker.fetch(
      new Request(
        "https://tools.serp.co/vendor/models/whisper-tiny/5332fcc35e32a33b86612b9a57a89be7906102b1/config.json",
      ),
      {},
      {},
    );

    assert.equal(response.status, upstreamStatus);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "text/plain;charset=UTF-8");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-upstream-secret"), null);
    assert.equal(await response.text(), "Model asset upstream request failed");
  });
}

test("Whisper proxy preserves a bodyless 304 validator response without model MIME", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 304,
      headers: {
        "cache-control": "max-age=0,must-revalidate",
        "content-type": "application/json",
        etag: '"pinned-validator"',
        "set-cookie": "model-validator=owned; Path=/; HttpOnly",
      },
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const generated = `export default {\n    async fetch(request, env, ctx) {\n        return new Response("fallback");\n    },\n};\n`;
  const worker = (
    await import(`data:text/javascript;base64,${Buffer.from(addIsolatedAssetAdapter(generated)).toString("base64")}`)
  ).default;
  const response = await worker.fetch(
    new Request(
      "https://tools.serp.co/vendor/models/whisper-tiny/5332fcc35e32a33b86612b9a57a89be7906102b1/config.json",
      { headers: { "if-none-match": '"pinned-validator"' } },
    ),
    {},
    {},
  );

  assert.equal(response.status, 304);
  assert.equal(response.headers.get("cache-control"), "max-age=0,must-revalidate");
  assert.equal(response.headers.get("content-type"), null);
  assert.equal(response.headers.get("etag"), '"pinned-validator"');
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(await response.text(), "");
});

test("Whisper proxy converts an upstream fetch failure into a bounded no-store 502", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("redirect chain leaked internal detail");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const generated = `export default {\n    async fetch(request, env, ctx) {\n        return new Response("fallback");\n    },\n};\n`;
  const worker = (
    await import(`data:text/javascript;base64,${Buffer.from(addIsolatedAssetAdapter(generated)).toString("base64")}`)
  ).default;
  const response = await worker.fetch(
    new Request(
      "https://tools.serp.co/vendor/models/whisper-tiny/5332fcc35e32a33b86612b9a57a89be7906102b1/config.json",
    ),
    {},
    {},
  );

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "text/plain;charset=UTF-8");
  assert.equal(await response.text(), "Model asset upstream request failed");
});

test("Cloudflare build verification covers emitted transcription and FFmpeg resources", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "tools-isolation-build-"));
  t.after(() => rmSync(root, { recursive: true }));
  const chunks = path.join(root, "_next", "static", "chunks");
  mkdirSync(chunks, { recursive: true });
  writeFileSync(path.join(chunks, "transcribe.js"), '"Xenova/whisper-tiny"');
  writeFileSync(
    path.join(chunks, "ffmpeg.js"),
    '"/vendor/ffmpeg";"ffmpeg-core.js";"ffmpeg-core.wasm"',
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

test("canonical Cloudflare build records revision-bound artifact provenance", () => {
  assert.match(buildSource, /writeCloudflareBuildProvenance/);
  assert.match(buildSource, /rev-parse/);
  assert.match(buildSource, /status.*--short/s);
});

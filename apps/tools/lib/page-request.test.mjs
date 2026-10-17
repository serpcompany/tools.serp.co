import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { barePageUrl, withBarePageRequests } from "./page-request.ts";

const ORIGIN = "https://tools.serp.co";

function bare(path, { method = "GET" } = {}) {
  const url = barePageUrl(method, new URL(path, ORIGIN));
  return url && url.href.slice(ORIGIN.length);
}

test("a GET or HEAD for a page path loses its query", () => {
  for (const method of ["GET", "HEAD"]) {
    assert.equal(bare("/3gp-to-hevc/?email=leak%40example.com", { method }), "/3gp-to-hevc/");
    assert.equal(bare("/?utm_source=news&gclid=xyz", { method }), "/");
    assert.equal(bare("/category/images/?page=2", { method }), "/category/images/");
    assert.equal(bare("/download-thisvid-videos/?url=https%3A%2F%2Fx.test%2Fv", { method }), "/download-thisvid-videos/");
  }
  // A client navigation's `_rsc` goes too.
  assert.equal(bare("/ai-to-webp/?email=x%40example.com&_rsc=1abcd"), "/ai-to-webp/");
  assert.equal(bare("/ai-to-webp/?_rsc=1abcd"), "/ai-to-webp/");
});

test("Next.js doesn't need `_rsc` on the server", () => {
  // With this setting on, Next.js redirects an RSC request whose `_rsc` is
  // missing; the redirect would be answered for the URL with its query.
  const require = createRequire(new URL("../package.json", import.meta.url));
  const { defaultConfig } = require("next/dist/server/config-shared");
  assert.equal(defaultConfig.experimental.validateRSCRequestHeaders, false);
  const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(config, /validateRSCRequestHeaders/);
});

test("other methods, URLs without a query and paths that aren't pages are left alone", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(bare("/3gp-to-hevc/?email=x", { method }), null, method);
  }
  for (const path of [
    "/3gp-to-hevc/",
    "/3gp-to-hevc/?",
    // Files and pages without their slash (middleware redirects those, query kept).
    "/3gp-to-hevc?email=x",
    "/robots.txt?x=1",
    "/sitemaps/tools-1.xml?x=1",
    "/favicon.ico?v=2",
    // Server code that reads the query.
    "/api/image-convert/?from=png&to=jpg",
    "/api/video-convert?from=mov&to=mp4",
    "/API/telemetry/?x=1",
    "/_next/image/?url=%2Fa.png&w=64&q=75",
    "/_next/static/chunks/a.js?dpl=1",
    "/internal/?x=1",
    "/internal/tools/?q=png",
    "/%69nternal/tools/?q=png",
    "/.well-known/security.txt/?x=1",
    "/cdn-cgi/image/width=64/a.png/?x=1",
  ]) {
    assert.equal(bare(path), null, path);
  }
});

function recordingHandler(respond) {
  const requests = [];
  return {
    requests,
    handler: {
      async fetch(request, env, ctx) {
        requests.push({ url: request.url, method: request.method, headers: request.headers, env, ctx });
        return respond(request);
      },
      queue: "kept",
    },
  };
}

test("the wrapped worker gets the bare request, with its method and headers", async () => {
  const { requests, handler } = recordingHandler(() => new Response("page"));
  const wrapped = withBarePageRequests(handler);
  assert.equal(wrapped.queue, "kept");
  const response = await wrapped.fetch(
    new Request(`${ORIGIN}/3gp-to-hevc/?email=leak%40example.com`, {
      method: "HEAD",
      headers: { "user-agent": "Googlebot", "x-tools-serp-smoke-test": "1" },
    }),
    "env",
    "ctx",
  );
  assert.equal(await response.text(), "page");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${ORIGIN}/3gp-to-hevc/`);
  assert.equal(requests[0].method, "HEAD");
  assert.equal(requests[0].headers.get("user-agent"), "Googlebot");
  assert.equal(requests[0].headers.get("x-tools-serp-smoke-test"), "1");
  assert.deepEqual([requests[0].env, requests[0].ctx], ["env", "ctx"]);
});

test("a request that isn't stripped reaches the worker as it came", async () => {
  const { requests, handler } = recordingHandler(() => new Response("api"));
  const request = new Request(`${ORIGIN}/api/image-convert/?from=png&to=jpg`, { method: "POST", body: "x" });
  await withBarePageRequests(handler).fetch(request, {}, {});
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, request.url);
});

test("a redirect is answered for the URL as requested, so it keeps the query", async () => {
  const { requests, handler } = recordingHandler((request) => {
    const url = new URL(request.url);
    // Middleware's rename redirect: keeps whatever query it is handed.
    return new Response(null, {
      status: 308,
      headers: { location: `${ORIGIN}/download-kajabi-videos/${url.search}` },
    });
  });
  const response = await withBarePageRequests(handler).fetch(
    new Request(`${ORIGIN}/download-kajab-videos/?utm_source=news`),
    {},
    {},
  );
  assert.deepEqual(
    requests.map((r) => r.url),
    [`${ORIGIN}/download-kajab-videos/`, `${ORIGIN}/download-kajab-videos/?utm_source=news`],
  );
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), `${ORIGIN}/download-kajabi-videos/?utm_source=news`);
});

test("a 304 or a 404 for the bare request is the answer", async () => {
  for (const status of [304, 404]) {
    const { requests, handler } = recordingHandler(() => new Response(null, { status }));
    const response = await withBarePageRequests(handler).fetch(
      new Request(`${ORIGIN}/foo-to-bar-xyz/?email=x`),
      {},
      {},
    );
    assert.equal(response.status, status);
    assert.deepEqual(requests.map((r) => r.url), [`${ORIGIN}/foo-to-bar-xyz/`]);
  }
});

test("the Worker entry hands Next.js the wrapped worker, inside Sentry", () => {
  const entry = readFileSync(new URL("../sentry-worker.mjs", import.meta.url), "utf8");
  assert.match(entry, /from "\.\/lib\/page-request\.ts"/);
  assert.match(entry, /withSentry\([\s\S]*withBarePageRequests\(nextApp\),?\s*\)/);
});

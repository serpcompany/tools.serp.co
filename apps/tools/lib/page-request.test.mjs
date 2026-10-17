import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

import { appRoot, isClientModule, repoRoot, routeFiles, walkModules } from "../scripts/lib/module-graph.mjs";
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
  // Not the dashboard: middleware's /internal/ check and Next.js routing are
  // both case-sensitive, so this is a 404 page.
  assert.equal(bare("/INTERNAL/tools/?q=png"), "/INTERNAL/tools/");
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

// barePageUrl relies on this: no page reads its query on the server. `next
// dev` never runs the Worker entry, so a page that did would work there and,
// on Workers, render and cache every `?page=2` as the bare page.
const ROUTE_FILE_NAMES = ["page", "layout", "template", "not-found", "route"];
const REQUEST = /^(?:req|request|\w*Request)$/;

// `request.url` (or `req.url`, `nextRequest.url`), or a local set to it.
function isRequestUrlString(node, locals, depth = 0) {
  if (depth > 8) return false;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return isRequestUrlString(node.expression, locals, depth + 1);
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "url" && ts.isIdentifier(node.expression) && REQUEST.test(node.expression.text);
  }
  if (ts.isIdentifier(node)) {
    return (locals.get(node.text) ?? []).some((init) => isRequestUrlString(init, locals, depth + 1));
  }
  return false;
}

// The request's URL object: `request.nextUrl`, `new URL(request.url)`, or a
// local set to one.
function isRequestUrl(node, locals, depth = 0) {
  if (depth > 8) return false;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return isRequestUrl(node.expression, locals, depth + 1);
  }
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "nextUrl";
  if (ts.isNewExpression(node)) {
    return ts.isIdentifier(node.expression) && node.expression.text === "URL" && Boolean(node.arguments?.[0]) &&
      isRequestUrlString(node.arguments[0], locals, depth + 1);
  }
  if (ts.isIdentifier(node)) {
    if (node.text === "nextUrl") return true;
    return (locals.get(node.text) ?? []).some((init) => isRequestUrl(init, locals, depth + 1));
  }
  return false;
}

// A URL the module builds from something other than the request, such as an
// outbound link it adds tracking to: `new URL(href)`, or a local set only to
// such URLs.
function isOwnUrl(node, locals) {
  const isNewUrl = (expression) =>
    ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "URL";
  if (isNewUrl(node)) return !isRequestUrl(node, locals);
  if (!ts.isIdentifier(node)) return false;
  const inits = locals.get(node.text) ?? [];
  return inits.length > 0 && inits.every((init) => isNewUrl(init) && !isRequestUrl(init, locals));
}

// Where a module reads the query, as "<file>:<line>: <what>". In a client
// module only useSearchParams counts: the rest of its code reads the address
// bar (location.search), which keeps the query.
function queryReads(sourceFile, file) {
  const client = isClientModule(sourceFile);
  const locals = new Map();
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      locals.set(node.name.text, [...(locals.get(node.name.text) ?? []), node.initializer]);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const reads = [];
  const report = (node, what) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    reads.push(`${path.relative(repoRoot, file)}:${line + 1}: ${what}`);
  };
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === "useSearchParams") {
      report(node, "useSearchParams");
    } else if (!client && ts.isIdentifier(node) && node.text === "searchParams") {
      const parent = node.parent;
      const isMember = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isMember || !isOwnUrl(parent.expression, locals)) {
        report(node, isMember ? `${parent.expression.getText(sourceFile)}.searchParams` : "searchParams");
      }
    } else if (
      !client &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "search" &&
      isRequestUrl(node.expression, locals)
    ) {
      report(node, `${node.getText(sourceFile)}`);
    } else if (
      !client &&
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isRequestUrl(node.initializer, locals)
    ) {
      for (const element of node.name.elements) {
        const name = element.propertyName ?? element.name;
        if (ts.isIdentifier(name) && name.text === "search") report(element, "search of the request URL");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return reads;
}

test("no page, layout or route outside /api/ and /internal/ reads its query on the server", () => {
  const appDir = path.join(appRoot, "app");
  const keepsQuery = [path.join(appDir, "api"), path.join(appDir, "internal")];
  const entries = routeFiles(appDir, ROUTE_FILE_NAMES).filter(
    (file) => !keepsQuery.some((dir) => file.startsWith(dir + path.sep)),
  );
  assert.ok(entries.includes(path.join(appDir, "category", "[categoryName]", "page.tsx")), "expected the category page");

  const reads = [];
  const modules = walkModules(entries, (sourceFile, file) => {
    reads.push(...queryReads(sourceFile, file));
  });

  assert.ok(modules > 200, `expected every page's module graph, found ${modules} modules`);
  assert.deepEqual(
    reads,
    [],
    "pages render without their query on Workers (page-request.ts): read it in client code, from location.search",
  );
});

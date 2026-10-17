import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { isStorable, withPageCacheFilter } from "./page-cache-filter.ts";

function recordingCache() {
  const calls = [];
  return {
    calls,
    cache: {
      name: "cf-r2-incremental-cache",
      async get(key, cacheType) {
        calls.push(["get", key, cacheType]);
        return { value: { type: "app", html: "<p>stored</p>" }, lastModified: 1 };
      },
      async set(key, value, cacheType) {
        calls.push(["set", key, value, cacheType]);
      },
      async delete(key) {
        calls.push(["delete", key]);
      },
    },
  };
}

// An App Router RSC payload as Next.js 15 writes it for a page rendered for
// `url`: client references first, then the root row with the URL split at "/"
// and the page segment key, which carries the query except `_rsc`.
function rscFor(url) {
  const { pathname, search, searchParams } = new URL(url, "https://tools.serp.co");
  searchParams.delete("_rsc");
  const query = Object.fromEntries(searchParams);
  const pageKey = Object.keys(query).length ? `__PAGE__?${JSON.stringify(query)}` : "__PAGE__";
  const tool = pathname.split("/")[1];
  const root = {
    P: null,
    b: "h5sSW78A0PfNXAnAN1KtP",
    p: "",
    c: (pathname + search).split("/"),
    i: false,
    f: [[["", { children: ["(convert)", { children: [["tool", tool, "d"], { children: [pageKey, {}] }] }] }], "$undefined", "$undefined", true]],
    S: true,
  };
  return `1:"$Sreact.fragment"\n2:I[9766,[],""]\n0:${JSON.stringify(root)}\n3:[]\n`;
}

const page = (url, { status } = {}) => ({
  type: "app",
  html: "<html></html>",
  rsc: rscFor(url),
  meta: { status, headers: {} },
  revalidate: false,
});

test("a page rendered for its bare path is stored unchanged", async () => {
  const { calls, cache } = recordingCache();
  const bare = page("/mts-to-mov/");
  await withPageCacheFilter(cache).set("/mts-to-mov", bare, "cache");
  assert.deepEqual(calls, [["set", "/mts-to-mov", bare, "cache"]]);

  // JSON leaves U+2028 and U+2029 unescaped; the root row still reads whole.
  const withLineSeparator = page("/mts-to-mov/");
  withLineSeparator.rsc = withLineSeparator.rsc.replace('"S":true', '"S":true,"t":"a\u2028b\u2029c"');
  assert.equal(isStorable(withLineSeparator), true);
});

test("a page rendered for a URL with a query string is not stored", async () => {
  const { calls, cache } = recordingCache();
  const wrapped = withPageCacheFilter(cache);
  for (const url of [
    "/mts-to-mov/?utm_source=news&email=QSLEAK%40example.com",
    "/download-thisvid-videos/?gclid=abc123",
    "/mts-to-mov/?flag",
    // An RSC or prefetch request: its page segment key has no query, but the
    // root row's URL still ends in "?_rsc=".
    "/ai-to-webp/?_rsc=WouAzwWRgQPI_gz1",
  ]) {
    await wrapped.set(new URL(url, "https://x").pathname, page(url), "cache");
  }
  assert.deepEqual(calls, []);
});

test("either trace of a query is enough to skip the store", () => {
  const withPageKeyOnly = page("/mts-to-mov/");
  withPageKeyOnly.rsc = withPageKeyOnly.rsc.replace('"__PAGE__"', '"__PAGE__?{\\"email\\":\\"a@b.c\\"}"');
  assert.equal(isStorable(withPageKeyOnly), false);

  const withUrlOnly = page("/mts-to-mov/");
  withUrlOnly.rsc = withUrlOnly.rsc.replace('"mts-to-mov",""]', '"mts-to-mov","?email=a%40b.c"]');
  assert.equal(isStorable(withUrlOnly), false);
});

test("a page whose payload can't be read is not stored", () => {
  const base = page("/mts-to-mov/");
  for (const rsc of [undefined, "", '1:I[9766,[],""]\n', "0:{not json\n", '0:{"b":"x"}\n', '0:{"c":"/mts-to-mov/"}\n']) {
    assert.equal(isStorable({ ...base, rsc }), false, `rsc ${JSON.stringify(rsc)}`);
  }
});

test("a page that answers 404 is not stored", async () => {
  const { calls, cache } = recordingCache();
  await withPageCacheFilter(cache).set("/foo-to-bar-xyz", page("/foo-to-bar-xyz/", { status: 404 }), "cache");
  assert.deepEqual(calls, []);
});

test("route, fetch and other entries pass through, whatever their status", async () => {
  const { calls, cache } = recordingCache();
  const wrapped = withPageCacheFilter(cache);
  const route = { type: "route", body: "<urlset/>", meta: { status: 200, headers: {} }, revalidate: false };
  const fetchEntry = { kind: "FETCH", data: { headers: {}, body: "", url: "https://example.com", status: 404 } };

  await wrapped.set("/sitemap.xml", route, "cache");
  await wrapped.set("fetch-key", fetchEntry, "fetch");

  assert.deepEqual(calls, [
    ["set", "/sitemap.xml", route, "cache"],
    ["set", "fetch-key", fetchEntry, "fetch"],
  ]);
});

test("reads and deletes pass through, and the cache keeps its name", async () => {
  const { calls, cache } = recordingCache();
  const wrapped = withPageCacheFilter(cache);

  assert.equal(wrapped.name, "cf-r2-incremental-cache");
  assert.deepEqual(await wrapped.get("/3gp-to-hevc", "cache"), {
    value: { type: "app", html: "<p>stored</p>" },
    lastModified: 1,
  });
  await wrapped.delete("/3gp-to-hevc");

  assert.deepEqual(calls, [
    ["get", "/3gp-to-hevc", "cache"],
    ["delete", "/3gp-to-hevc"],
  ]);
});

test("the OpenNext config wraps its whole incremental cache, regional layer included", () => {
  const config = readFileSync(new URL("../open-next.config.ts", import.meta.url), "utf8");
  assert.match(config, /incrementalCache:\s*withPageCacheFilter\(\s*withRegionalCache\(/);
});

// The filter reads where Next.js writes the request's query. If an upgrade
// moves it, every page would stop being stored (or, if this were relaxed, a
// query could get through): re-check the payload, then update both.
test("the installed Next.js still writes the query where the filter reads it", () => {
  const require = createRequire(import.meta.url);
  const appRender = readFileSync(require.resolve("next/dist/server/app-render/app-render.js"), "utf8");
  const segment = readFileSync(require.resolve("next/dist/shared/lib/segment.js"), "utf8");

  assert.match(appRender, /function prepareInitialCanonicalUrl\(url\) \{\s*return \(url\.pathname \+ url\.search\)\.split\('\/'\);/);
  assert.match(appRender, /\bc: prepareInitialCanonicalUrl\(url\),/);
  assert.match(segment, /PAGE_SEGMENT_KEY \+ '\?' \+ stringifiedQuery/);
});

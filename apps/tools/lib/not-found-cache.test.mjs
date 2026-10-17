import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { withoutNotFoundPages } from "./not-found-cache.ts";

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

const page = (status) => ({
  type: "app",
  html: "<html></html>",
  rsc: "0:{}",
  meta: { status, headers: {} },
  revalidate: false,
});

test("a page that answers 404 is not stored", async () => {
  const { calls, cache } = recordingCache();
  await withoutNotFoundPages(cache).set("/foo-to-bar-xyz", page(404), "cache");
  assert.deepEqual(calls, []);
});

test("pages that answer 200, and entries without a status, are stored unchanged", async () => {
  const { calls, cache } = recordingCache();
  const wrapped = withoutNotFoundPages(cache);
  const ok = page(200);
  const unknownStatus = { type: "app", html: "<html></html>", meta: { headers: {} } };
  const fetchEntry = { kind: "FETCH", data: { headers: {}, body: "", url: "https://example.com", status: 404 } };

  await wrapped.set("/3gp-to-hevc", ok, "cache");
  await wrapped.set("/no-status", unknownStatus);
  await wrapped.set("fetch-key", fetchEntry, "fetch");

  assert.deepEqual(calls, [
    ["set", "/3gp-to-hevc", ok, "cache"],
    ["set", "/no-status", unknownStatus, undefined],
    ["set", "fetch-key", fetchEntry, "fetch"],
  ]);
});

test("reads and deletes pass through, and the cache keeps its name", async () => {
  const { calls, cache } = recordingCache();
  const wrapped = withoutNotFoundPages(cache);

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
  assert.match(config, /incrementalCache:\s*withoutNotFoundPages\(\s*withRegionalCache\(/);
});

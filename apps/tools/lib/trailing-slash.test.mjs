import test from "node:test";
import assert from "node:assert/strict";

import { canonicalPath, isFilePath } from "./trailing-slash.ts";

test("pages end in a slash", () => {
  assert.equal(canonicalPath("/png-to-jpg"), "/png-to-jpg/");
  assert.equal(canonicalPath("/png-to-jpg/"), "/png-to-jpg/");
  assert.equal(canonicalPath("/category/image"), "/category/image/");
  assert.equal(canonicalPath("/docs/api"), "/docs/api/");
  assert.equal(canonicalPath("/"), "/");
});

test("files never end in a slash", () => {
  for (const file of ["/robots.txt", "/sitemap-index.xml", "/ads.txt", "/favicon.ico", "/vendor/ffmpeg-esm/worker.js"]) {
    assert.equal(canonicalPath(file), file);
    assert.equal(canonicalPath(`${file}/`), file);
  }
});

test("a dot only makes a file with a known extension", () => {
  assert.equal(isFilePath("/x/report.pdf"), true);
  assert.equal(isFilePath("/products/aws.amazon.com"), false);
  assert.equal(canonicalPath("/products/aws.amazon.com"), "/products/aws.amazon.com/");
  assert.equal(canonicalPath("/v1.2"), "/v1.2/");
});

test("/api, /.well-known and framework paths are left exactly as requested", () => {
  for (const path of [
    "/api", "/api/", "/API", "/api/telemetry", "/api/telemetry/", "/api/x.json/",
    "/.well-known/security.txt", "/.WELL-KNOWN/foo", "/_next/static/chunks/a.js", "/cdn-cgi/rum",
  ]) {
    assert.equal(canonicalPath(path), path, path);
  }
});

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

test("old routes go to their canonical page in one step", () => {
  assert.equal(canonicalPath("/download-kajab-videos"), "/download-kajabi-videos/");
  assert.equal(canonicalPath("/download-kajab-videos/"), "/download-kajabi-videos/");
  assert.equal(canonicalPath("/png-to-png"), "/compress-png/");
  assert.equal(canonicalPath("/loom-video-downloader/"), "/download-loom-videos/");
  assert.equal(canonicalPath("/download-kajabi-videos/"), "/download-kajabi-videos/");
});

test("vendor file types used by the PDF viewer are files", () => {
  assert.equal(canonicalPath("/vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap/"), "/vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap");
  assert.equal(canonicalPath("/vendor/x/viewer.ftl/"), "/vendor/x/viewer.ftl");
});

test("/api, /.well-known and framework paths are left exactly as requested", () => {
  for (const path of [
    "/api", "/api/", "/API", "/api/telemetry", "/api/telemetry/", "/api/x.json/",
    "/.well-known/security.txt", "/.WELL-KNOWN/foo", "/_next/static/chunks/a.js", "/cdn-cgi/rum",
  ]) {
    assert.equal(canonicalPath(path), path, path);
  }
});

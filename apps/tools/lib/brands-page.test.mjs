import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const brandsPageUrl = new URL("../app/brands/page.tsx", import.meta.url);
const brandsPagePath = fileURLToPath(brandsPageUrl);
const brandsPageSource = existsSync(brandsPagePath)
  ? readFileSync(brandsPageUrl, "utf8")
  : "";
const sitemapSource = readFileSync(new URL("./sitemap.ts", import.meta.url), "utf8");

test("brands route exists and is backed by network brands data", () => {
  assert.notEqual(brandsPageSource, "");
  assert.match(brandsPageSource, /getNetworkBrands/);
});

test("brands route is static and exports page metadata", () => {
  assert.match(brandsPageSource, /dynamic\s*=\s*"force-static"/);
  assert.match(brandsPageSource, /title:\s*"Brands \| SERP Tools"/);
  assert.match(brandsPageSource, /canonical:\s*"\/brands\/"/);
  assert.match(brandsPageSource, /openGraph/);
  assert.match(brandsPageSource, /twitter/);
});

test("brands page renders compact directory brand cards", () => {
  assert.match(brandsPageSource, /import Link from "next\/link"/);
  assert.match(brandsPageSource, /brand\.hostname/);
  assert.match(brandsPageSource, /href=\{brand\.url\}/);
  assert.match(brandsPageSource, /prefetch=\{false\}/);
  assert.match(brandsPageSource, /target="_blank"/);
  assert.match(brandsPageSource, /rel="noreferrer noopener"/);
  assert.match(brandsPageSource, /ExternalLink/);
  assert.match(brandsPageSource, /rounded-xl border bg-background p-5/);
  assert.doesNotMatch(brandsPageSource, /Visit/);
});

test("static sitemap paths include the brands page", () => {
  assert.match(sitemapSource, /"\/brands\/"/);
});

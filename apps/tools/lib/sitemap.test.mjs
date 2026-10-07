import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getSitemapFiles,
  resolveSitemapRequest,
  SITEMAP_INDEX_PATH,
} from "./sitemap.ts";

const tools = JSON.parse(
  readFileSync(new URL("./catalog/tools.json", import.meta.url), "utf8"),
);
const origin = "https://tools.serp.co";

function xml(fileName, options = {}) {
  const result = resolveSitemapRequest(fileName, { origin, tools, ...options });
  assert.equal(result.type, "xml", `${fileName} should serve XML`);
  return result.body;
}

function locs(body) {
  return [...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
}

test("the index lists only root-level URL sets named by content group", () => {
  const body = xml("sitemap-index.xml");
  assert.match(body, /^<\?xml version="1\.0" encoding="UTF-8"\?><sitemapindex /);
  assert.deepEqual(locs(body), [
    `${origin}/sitemap-pages.xml`,
    `${origin}/sitemap-tools.xml`,
    `${origin}/sitemap-categories.xml`,
  ]);

  // Never an index pointing at an index.
  for (const loc of locs(body)) {
    const child = xml(loc.slice(origin.length + 1));
    assert.match(child, /<urlset /, loc);
    assert.doesNotMatch(child, /<sitemapindex/, loc);
  }
});

test("the homepage is the bare origin and every other page ends in a slash", () => {
  const pages = locs(xml("sitemap-pages.xml"));
  assert.equal(pages[0], origin);
  assert.ok(!pages.includes(`${origin}/`), "homepage must not be written with a slash");
  assert.deepEqual(pages, [origin, `${origin}/categories/`, `${origin}/brands/`]);

  const all = ["sitemap-pages.xml", "sitemap-tools.xml", "sitemap-categories.xml"].flatMap(
    (fileName) => locs(xml(fileName)),
  );
  for (const loc of all) {
    if (loc === origin) continue;
    assert.ok(loc.startsWith(`${origin}/`), loc);
    assert.ok(loc.endsWith("/"), `${loc} should end in a slash`);
  }
  assert.equal(new Set(all).size, all.length, "each URL appears once in the tree");
});

test("the tools sitemap lists every active tool and no inactive one", () => {
  const toolLocs = new Set(locs(xml("sitemap-tools.xml")));
  const active = tools.filter((tool) => tool.isActive);
  const inactive = tools.filter((tool) => !tool.isActive);
  assert.ok(inactive.length > 0, "fixture should include inactive tools");

  assert.equal(toolLocs.size, active.length);
  for (const tool of active) {
    assert.ok(toolLocs.has(`${origin}${tool.route.replace(/\/?$/, "/")}`), tool.id);
  }
  for (const tool of inactive) {
    assert.ok(!toolLocs.has(`${origin}${tool.route.replace(/\/?$/, "/")}`), tool.id);
  }
});

test("the categories sitemap lists the active operation categories", () => {
  const categoryLocs = locs(xml("sitemap-categories.xml"));
  assert.ok(categoryLocs.length > 0);
  for (const loc of categoryLocs) {
    assert.match(loc, /^https:\/\/tools\.serp\.co\/category\/[a-z-]+\/$/);
  }
});

test("a group past the URL limit overflows into numbered files listed by the index", () => {
  const files = getSitemapFiles(tools, 1000);
  const toolFiles = files.filter((file) => file.group === "tools").map((file) => file.path);
  assert.deepEqual(toolFiles, [
    "/sitemap-tools.xml",
    "/sitemap-tools-2.xml",
    "/sitemap-tools-3.xml",
  ]);
  assert.ok(files.every((file) => file.paths.length <= 1000));

  const index = xml("sitemap-index.xml", { maxUrls: 1000 });
  assert.ok(locs(index).includes(`${origin}/sitemap-tools-3.xml`));
  const lastToolFile = files.find((file) => file.path === "/sitemap-tools-3.xml");
  assert.equal(locs(xml("sitemap-tools-3.xml", { maxUrls: 1000 })).length, lastToolFile.paths.length);
  assert.deepEqual(resolveSitemapRequest("sitemap-tools-4.xml", { origin, tools, maxUrls: 1000 }), {
    type: "not-found",
  });
});

test("the default limit is the sitemaps.org limit of 50,000 URLs", () => {
  assert.ok(getSitemapFiles(tools).every((file) => !/-\d+\.xml$/.test(file.path)));
  const many = Array.from({ length: 50_001 }, (_, index) => ({
    route: `/tool-${index}`,
    isActive: true,
    operation: "convert",
  }));
  assert.deepEqual(
    getSitemapFiles(many)
      .filter((file) => file.group === "tools")
      .map((file) => [file.path, file.paths.length]),
    [
      ["/sitemap-tools.xml", 50_000],
      ["/sitemap-tools-2.xml", 1],
    ],
  );
});

test("/sitemap.xml and retired sitemap names 308 into the flat tree", () => {
  const redirects = {
    "sitemap.xml": SITEMAP_INDEX_PATH,
    "sitemap-0.xml": SITEMAP_INDEX_PATH,
    "sitemap-1.xml": SITEMAP_INDEX_PATH,
    "pages-index.xml": SITEMAP_INDEX_PATH,
    "tools-index.xml": SITEMAP_INDEX_PATH,
    "categories-index.xml": SITEMAP_INDEX_PATH,
    "pages-0.xml": "/sitemap-pages.xml",
    "tools-0.xml": "/sitemap-tools.xml",
    "tools-1.xml": "/sitemap-tools.xml",
    "categories-0.xml": "/sitemap-categories.xml",
  };
  for (const [fileName, target] of Object.entries(redirects)) {
    assert.deepEqual(
      resolveSitemapRequest(fileName, { origin, tools }),
      { type: "redirect", location: `${origin}${target}` },
      fileName,
    );
  }
});

test("unknown sitemap names are not found", () => {
  for (const fileName of ["sitemap-blog.xml", "sitemap-tools-1.xml", "tools.xml", "pages-x.xml"]) {
    assert.deepEqual(resolveSitemapRequest(fileName, { origin, tools }), { type: "not-found" }, fileName);
  }
});

test("URLs use the origin they are given, such as a local one", () => {
  const local = "http://localhost:8790";
  const index = resolveSitemapRequest("sitemap-index.xml", { origin: local, tools });
  assert.ok(locs(index.body).every((loc) => loc.startsWith(`${local}/sitemap-`)));
  const pages = resolveSitemapRequest("sitemap-pages.xml", { origin: local, tools });
  assert.equal(locs(pages.body)[0], local);
  assert.ok(!pages.body.includes("tools.serp.co"));
  assert.deepEqual(resolveSitemapRequest("sitemap.xml", { origin: local, tools }), {
    type: "redirect",
    location: `${local}/sitemap-index.xml`,
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { activeTools, allTools } from "./catalog/catalog.ts";
import { normalizePath } from "./sitemap.ts";
import {
  SITE_NAME,
  serializeJsonLd,
  siteOrigin,
  toolStructuredData,
} from "./structured-data.ts";

const ORIGIN = "https://tools.serp.co";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// What a page passes: its H1 and subtitle, which come from the registry
// entry's content, else its name and description.
const pageText = (tool) => ({
  toolId: tool.id,
  name: tool.content?.tool.title ?? tool.name,
  description: tool.content?.tool.subtitle ?? tool.description,
});

const byId = (id) => {
  const tool = activeTools().find((candidate) => candidate.id === id);
  assert.ok(tool, `${id} is an active Tool`);
  return tool;
};

// The page's <link rel="canonical">: metadata.ts writes normalizePath(route)
// and Next.js resolves it against app/layout.tsx's metadataBase.
const canonicalOf = (tool, origin = ORIGIN) =>
  new URL(normalizePath(tool.route), new URL(origin)).href;

// What a crawler reads back from the <script> tag.
const parsed = (tool, origin = ORIGIN) => {
  const data = toolStructuredData(pageText(tool), origin);
  assert.ok(data, `${tool.id} has structured data`);
  return JSON.parse(serializeJsonLd(data));
};

const nodeOf = (data, type) => data["@graph"].find((node) => node["@type"] === type);

const typesIn = (value, types = new Set()) => {
  if (Array.isArray(value)) {
    for (const item of value) typesIn(item, types);
  } else if (value && typeof value === "object") {
    if (value["@type"]) types.add(value["@type"]);
    for (const item of Object.values(value)) typesIn(item, types);
  }
  return types;
};

// The pages ToolPageTemplate and DownloaderPageTemplate serve: converters and
// compressors with both formats, and every downloader.
const templatedTools = () =>
  activeTools().filter(
    (tool) =>
      tool.operation === "download" ||
      ((tool.operation === "convert" || tool.operation === "compress") && tool.from && tool.to),
  );

test("a converter page is a free WebApplication under Home > Convert Tools", () => {
  const data = parsed(byId("mp4-to-mp3"));

  assert.equal(data["@context"], "https://schema.org");
  assert.deepEqual(data["@graph"].map((node) => node["@type"]), ["WebApplication", "BreadcrumbList"]);
  assert.deepEqual(nodeOf(data, "WebApplication"), {
    "@type": "WebApplication",
    name: pageText(byId("mp4-to-mp3")).name,
    url: "https://tools.serp.co/mp4-to-mp3/",
    description: pageText(byId("mp4-to-mp3")).description,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  });
  assert.deepEqual(nodeOf(data, "BreadcrumbList").itemListElement, [
    { "@type": "ListItem", position: 1, name: SITE_NAME, item: "https://tools.serp.co" },
    { "@type": "ListItem", position: 2, name: "Convert Tools", item: "https://tools.serp.co/category/convert/" },
    {
      "@type": "ListItem",
      position: 3,
      name: pageText(byId("mp4-to-mp3")).name,
      item: "https://tools.serp.co/mp4-to-mp3/",
    },
  ]);
});

test("a Lander sits under Downloaders and a compressor under Compress Tools, at its route", () => {
  const lander = parsed(byId("download-thisvid-videos"));
  assert.equal(nodeOf(lander, "WebApplication").url, "https://tools.serp.co/download-thisvid-videos/");
  assert.equal(nodeOf(lander, "WebApplication").name, "ThisVid Video Downloader");
  assert.equal(nodeOf(lander, "WebApplication").applicationCategory, "MultimediaApplication");
  assert.deepEqual(
    nodeOf(lander, "BreadcrumbList").itemListElement[1],
    { "@type": "ListItem", position: 2, name: "Downloaders", item: "https://tools.serp.co/category/download/" },
  );

  // Registry id png-to-png is served at /compress-png/.
  const compressor = parsed(byId("png-to-png"));
  assert.equal(nodeOf(compressor, "WebApplication").url, "https://tools.serp.co/compress-png/");
  assert.equal(nodeOf(compressor, "WebApplication").applicationCategory, "UtilitiesApplication");
  assert.equal(nodeOf(compressor, "BreadcrumbList").itemListElement[1].item, "https://tools.serp.co/category/compress/");

  assert.equal(nodeOf(parsed(byId("jpg-to-png")), "WebApplication").applicationCategory, "UtilitiesApplication");
});

test("every templated Tool page: valid JSON, absolute canonical URLs, breadcrumbs from position 1", () => {
  const tools = templatedTools();
  assert.ok(tools.length > 2000, `${tools.length} templated Tools`);

  for (const tool of tools) {
    const data = parsed(tool);
    const app = nodeOf(data, "WebApplication");
    const crumbs = nodeOf(data, "BreadcrumbList").itemListElement;

    assert.equal(app.url, canonicalOf(tool), tool.id);
    assert.ok(app.name && app.description, tool.id);
    assert.deepEqual(app.offers, { "@type": "Offer", price: "0", priceCurrency: "USD" }, tool.id);
    assert.equal(app.operatingSystem, "Any", tool.id);

    assert.deepEqual(crumbs.map((crumb) => crumb.position), [1, 2, 3], tool.id);
    assert.equal(crumbs[0].item, ORIGIN, tool.id);
    assert.equal(crumbs[1].item, `${ORIGIN}/category/${tool.operation}/`, tool.id);
    assert.equal(crumbs[2].item, app.url, tool.id);
    assert.equal(crumbs[2].name, app.name, tool.id);
    for (const crumb of crumbs) {
      assert.equal(new URL(crumb.item).origin, ORIGIN, `${tool.id}: ${crumb.item}`);
      assert.ok(crumb.name, tool.id);
    }

    // Nothing the page can't back: no ratings, reviews, FAQ or HowTo markup.
    assert.deepEqual(
      [...typesIn(data)].sort(),
      ["BreadcrumbList", "ListItem", "Offer", "WebApplication"],
      tool.id,
    );
  }
});

test("URLs use the build's site origin, as the canonical does", () => {
  assert.equal(siteOrigin(undefined), "https://tools.serp.co");
  assert.equal(siteOrigin("https://tools.serp.co"), "https://tools.serp.co");
  assert.equal(siteOrigin("https://staging.tools.serp.co/"), "https://staging.tools.serp.co");
  assert.equal(siteOrigin("tools.serp.co"), "https://tools.serp.co");
  assert.equal(siteOrigin("http://localhost:8787"), "http://localhost:8787");

  const staging = "https://staging.tools.serp.co";
  const data = parsed(byId("mp4-to-mp3"), staging);
  assert.equal(nodeOf(data, "WebApplication").url, canonicalOf(byId("mp4-to-mp3"), staging));
  assert.deepEqual(
    nodeOf(data, "BreadcrumbList").itemListElement.map((crumb) => crumb.item),
    [staging, `${staging}/category/convert/`, `${staging}/mp4-to-mp3/`],
  );
});

test("an id that isn't an active Tool gets no structured data", () => {
  const inactive = allTools().find((tool) => !tool.isActive);
  assert.ok(inactive);
  assert.equal(toolStructuredData({ toolId: inactive.id, name: "x", description: "y" }, ORIGIN), null);
  assert.equal(toolStructuredData({ toolId: "not-a-tool", name: "x", description: "y" }, ORIGIN), null);
  assert.equal(toolStructuredData({ toolId: undefined, name: "x", description: "y" }, ORIGIN), null);
});

test("page text can't end the script tag or change how HTML parses it", () => {
  const hostile = "MP4 </script><script>alert(1)</script> <!-- --> & </SCRIPT \u2028\u2029";
  const data = toolStructuredData(
    { toolId: "mp4-to-mp3", name: hostile, description: `${hostile} <b>bold</b>` },
    ORIGIN,
  );
  const json = serializeJsonLd(data);

  assert.doesNotMatch(json, /[<>&\u2028\u2029]/);
  assert.deepEqual(JSON.parse(json), data);

  const html = `<script type="application/ld+json">${json}</script>`;
  assert.equal(html.toLowerCase().indexOf("</script"), html.length - "</script>".length);
});

test("each template mounts the one JSON-LD script once", () => {
  for (const template of ["../components/ToolPageTemplate.tsx", "../components/DownloaderPageTemplate.tsx"]) {
    assert.equal(source(template).match(/<StructuredData\b/g)?.length, 1, template);
  }
  const component = source("../components/StructuredData.tsx");
  assert.equal(component.match(/application\/ld\+json/g)?.length, 1);
  assert.match(component, /serializeJsonLd\(/);
});

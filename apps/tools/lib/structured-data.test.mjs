import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";

import { activeTools, allTools } from "./catalog/catalog.ts";
import {
  serializeJsonLd,
  structuredDataOrigin,
  toolStructuredData,
} from "./structured-data.ts";

// lib/metadata.ts imports by the "@/" alias (tsconfig paths), which Node
// doesn't read: resolve it to apps/tools/ with the extension Next.js adds.
const appRoot = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("@/")) return next(specifier, context);
    const base = new URL(specifier.slice(2), appRoot).href;
    const url = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(
      (candidate) => /\.tsx?$/.test(candidate) && existsSync(new URL(candidate)),
    );
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});
const { buildToolMetadata } = await import("./metadata.ts");

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

// The page's <link rel="canonical">: what buildToolMetadata (each Tool route's
// generateMetadata) puts in alternates.canonical, resolved on
// app/layout.tsx's metadataBase as Next.js does. Calling the real code, not a
// copy, fails this test if metadata.ts changes how a canonical is built and
// structured-data.ts doesn't follow.
const canonicalOf = (tool, origin = ORIGIN) => {
  const canonical = buildToolMetadata(tool.id).alternates?.canonical;
  assert.equal(typeof canonical, "string", `${tool.id} has a canonical`);
  return new URL(canonical, new URL(origin)).href;
};

// What a crawler reads back from the <script> tag.
const parsed = (tool, origin = ORIGIN) => {
  const data = toolStructuredData(pageText(tool), origin);
  assert.ok(data, `${tool.id} has structured data`);
  return JSON.parse(serializeJsonLd(data));
};

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

test("a converter page is a free WebApplication at its canonical URL", () => {
  const tool = byId("mp4-to-mp3");

  assert.deepEqual(parsed(tool), {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: pageText(tool).name,
    url: "https://tools.serp.co/mp4-to-mp3/",
    description: pageText(tool).description,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  });
});

test("a Lander and a compressor are at their routes", () => {
  const lander = parsed(byId("download-thisvid-videos"));
  assert.equal(lander.url, "https://tools.serp.co/download-thisvid-videos/");
  assert.equal(lander.name, "ThisVid Video Downloader");
  assert.equal(lander.applicationCategory, "MultimediaApplication");

  // Registry id png-to-png is served at /compress-png/.
  const compressor = parsed(byId("png-to-png"));
  assert.equal(compressor.url, "https://tools.serp.co/compress-png/");
  assert.equal(compressor.applicationCategory, "UtilitiesApplication");

  assert.equal(parsed(byId("jpg-to-png")).applicationCategory, "UtilitiesApplication");
});

test("every templated Tool page: valid JSON, url is the canonical metadata.ts writes, nothing it can't back", () => {
  const tools = templatedTools();
  assert.ok(tools.length > 2000, `${tools.length} templated Tools`);

  for (const tool of tools) {
    const data = parsed(tool);

    assert.equal(data["@type"], "WebApplication", tool.id);
    assert.equal(data.url, canonicalOf(tool), tool.id);
    assert.equal(new URL(data.url).origin, ORIGIN, tool.id);
    assert.ok(data.name && data.description, tool.id);
    assert.deepEqual(data.offers, { "@type": "Offer", price: "0", priceCurrency: "USD" }, tool.id);
    assert.equal(data.operatingSystem, "Any", tool.id);

    // No ratings, reviews, FAQ, HowTo or breadcrumb markup.
    assert.deepEqual([...typesIn(data)].sort(), ["Offer", "WebApplication"], tool.id);
  }
});

test("URLs use the deployment's canonical origin, as the canonical does", () => {
  const production = { siteEnv: "production", siteUrl: "https://tools.serp.co" };
  const staging = { siteEnv: "staging", siteUrl: "https://staging.tools.serp.co" };
  assert.equal(structuredDataOrigin(production), "https://tools.serp.co");
  assert.equal(structuredDataOrigin(staging), "https://staging.tools.serp.co");
  assert.equal(structuredDataOrigin({ siteEnv: "staging", siteUrl: "https://staging.tools.serp.co/" }), "https://staging.tools.serp.co");
  assert.equal(structuredDataOrigin({ siteEnv: "production", siteUrl: "tools.serp.co" }), "https://tools.serp.co");
  // A deployed build without its URL fails instead of writing another origin.
  assert.throws(() => structuredDataOrigin({ siteEnv: "production", siteUrl: undefined }), /NEXT_PUBLIC_SITE_URL is unset/);
  // Local runs: a cf:build inlines the production URL, next dev none; either
  // way metadataBase is https://tools.serp.co.
  for (const env of [{ siteEnv: undefined, siteUrl: "https://tools.serp.co" }, { siteEnv: undefined, siteUrl: undefined }]) {
    assert.equal(structuredDataOrigin(env), "https://tools.serp.co");
  }

  const tool = byId("mp4-to-mp3");
  const origin = structuredDataOrigin(staging);
  assert.equal(parsed(tool, origin).url, "https://staging.tools.serp.co/mp4-to-mp3/");
  assert.equal(parsed(tool, origin).url, canonicalOf(tool, staging.siteUrl));
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

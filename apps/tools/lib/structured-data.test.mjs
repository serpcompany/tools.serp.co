import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import ts from "typescript";

import {
  appRoot as appDir,
  isClientModule,
  parse,
  resolveImport,
  routeFiles,
} from "../scripts/lib/module-graph.mjs";
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
const { buildTableConvertMetadata } = await import("./table-convert.ts");

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

// Which page renders each Tool, and how many JSON-LD scripts it renders,
// read from the source with the TypeScript parser. No page can be rendered
// here, so the module graph stands in for it.

const realPath = (...segments) => realpathSync(path.join(appDir, ...segments));
const structuredDataFile = realPath("components", "StructuredData.tsx");
const toolRoutePage = realPath("app", "(convert)", "[tool]", "page.tsx");

// Every page under app/ by the path it serves: route groups such as
// (convert) add nothing to it.
const pageFiles = new Map(
  routeFiles(path.join(appDir, "app"), ["page"]).map((file) => {
    const segments = path
      .relative(path.join(appDir, "app"), path.dirname(file))
      .split(path.sep)
      .filter((segment) => segment && !/^\(.*\)$/.test(segment));
    return [`/${segments.join("/")}`, realpathSync(file)];
  }),
);
const routeOf = (tool) => tool.route.replace(/\/+$/, "") || "/";

// The components a module renders: one entry for each JSX element whose tag
// is a name it imports from the repository, with the file it comes from.
function renderedComponents(file) {
  const sourceFile = parse(file);
  const imported = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const target = resolveImport(statement.moduleSpecifier.text, file);
    if (!clause || clause.isTypeOnly || !target) continue;
    if (clause.name) imported.set(clause.name.text, target);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) imported.set(element.name.text, target);
    }
  }
  const rendered = [];
  const visit = (node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ts.isIdentifier(node.tagName)) {
      const target = imported.get(node.tagName.text);
      if (target) rendered.push({ name: node.tagName.text, file: target });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return rendered;
}

// How many JSON-LD scripts a module renders: each <StructuredData> element in
// it and in the components it renders, all branches added up. A client module
// renders none: StructuredData reads the registry, which must stay out of the
// browser (catalog/client-boundary.test.mjs).
const mountCounts = new Map();
function mounts(file) {
  if (file === structuredDataFile) return 1;
  if (!mountCounts.has(file)) {
    mountCounts.set(file, 0); // a cycle adds nothing
    const count = isClientModule(parse(file))
      ? 0
      : renderedComponents(file).reduce((sum, component) => sum + mounts(component.file), 0);
    mountCounts.set(file, count);
  }
  return mountCounts.get(file);
}

// What app/(convert)/[tool]/page.tsx renders for a Tool with no folder of its
// own. The "coming soon" editors get ToolPlaceholder, which has no JSON-LD.
const COMING_SOON = new Set(["video-editor", "image-editor", "audio-editor"]);
function toolRouteComponent(tool) {
  if ((tool.operation === "convert" || tool.operation === "compress") && tool.from && tool.to) {
    return "ToolPageRenderer";
  }
  if (tool.operation === "download") return "DownloaderPageRenderer";
  if (COMING_SOON.has(tool.operation)) return "ToolPlaceholder";
  if (tool.operation === "view" || tool.operation === "edit") return "PdfToolPage";
  return undefined;
}
const toolRouteComponents = new Map(
  renderedComponents(toolRoutePage).map(({ name, file }) => [name, file]),
);

// The module that renders an active Tool's page: its folder's page, else the
// component the [tool] route renders for it.
const pageModuleOf = (tool) =>
  pageFiles.get(routeOf(tool)) ?? toolRouteComponents.get(toolRouteComponent(tool));

const isComingSoon = (tool) => !pageFiles.has(routeOf(tool)) && COMING_SOON.has(tool.operation);
const liveTools = () => activeTools().filter((tool) => !isComingSoon(tool));

// A page's top-level `const name = "value"` strings (`"csv" as const` too).
function stringConstants(file) {
  const constants = new Map();
  for (const statement of parse(file).statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let value = declaration.initializer;
      if (value && ts.isAsExpression(value)) value = value.expression;
      if (ts.isIdentifier(declaration.name) && value && ts.isStringLiteral(value)) {
        constants.set(declaration.name.text, value.text);
      }
    }
  }
  return constants;
}

// A table converter's page: what it passes TableConvertLanding and
// buildTableConvertMetadata. TableConvertLanding gives StructuredData the
// Tool id `${from}-to-${to}`; null for a page that isn't one.
function tablePage(file) {
  if (!renderedComponents(file).some(({ name }) => name === "TableConvertLanding")) return null;
  const constants = stringConstants(file);
  const page = {
    from: constants.get("fromFormat"),
    to: constants.get("toFormat"),
    title: constants.get("title"),
    slug: constants.get("slug"),
  };
  assert.ok(page.from && page.to && page.title && page.slug, `${file} declares its formats, title and slug`);
  return { ...page, toolId: `${page.from}-to-${page.to}` };
}

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

test("every live Tool page outside the table converters: valid JSON, url is the canonical metadata.ts writes, nothing it can't back", () => {
  const tools = liveTools().filter((tool) => !tablePage(pageModuleOf(tool)));
  assert.ok(tools.length > 2400, `${tools.length} Tool pages`);

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

test("a table converter's url is the canonical its page's metadata writes", () => {
  let pages = 0;
  for (const tool of liveTools()) {
    const page = tablePage(pageModuleOf(tool));
    if (!page) continue;
    pages += 1;

    assert.equal(page.toolId, tool.id, `${routeOf(tool)} is the page of ${page.toolId}`);
    const data = toolStructuredData({ toolId: page.toolId, name: page.title, description: "line" }, ORIGIN);
    const canonical = buildTableConvertMetadata(page).alternates?.canonical;
    assert.equal(typeof canonical, "string", `${tool.id} has a canonical`);
    assert.equal(data?.url, new URL(canonical, ORIGIN).href, tool.id);
    assert.equal(data.applicationCategory, "UtilitiesApplication", tool.id);
  }
  // 86 TableConvertLanding pages; json-to-csv and html-to-markdown have their own.
  assert.ok(pages >= 80, `${pages} table converter pages`);
});

test("the [tool] route renders a template, the PDF page or the placeholder, and nothing else", () => {
  // A new branch there needs toolRouteComponent above to say which Tools get it.
  assert.deepEqual(
    [...toolRouteComponents.keys()].sort(),
    ["DownloaderPageRenderer", "PdfToolPage", "ToolPageRenderer", "ToolPlaceholder"],
  );
});

test("every live Tool page renders one JSON-LD script; the coming-soon editors none", () => {
  const counts = activeTools().map((tool) => {
    const page = pageModuleOf(tool);
    assert.ok(page, `${tool.id}: a page renders it`);
    return { tool, count: mounts(page) };
  });

  const wrong = counts.filter(({ tool, count }) => count !== (isComingSoon(tool) ? 0 : 1));
  assert.deepEqual(wrong.map(({ tool, count }) => `${tool.id}: ${count}`), []);
  assert.ok(counts.length > 2500, `${counts.length} active Tools`);
  assert.deepEqual(
    counts.filter(({ count }) => count === 0).map(({ tool }) => tool.operation).sort(),
    [...COMING_SOON].sort(),
  );

  // A folder page passes its own Tool's id.
  for (const { tool } of counts) {
    const file = pageFiles.get(routeOf(tool));
    if (!file || tablePage(file)) continue;
    assert.equal(stringConstants(file).get("toolId"), tool.id, file);
  }
});

test("pages that aren't a live Tool's render no JSON-LD", () => {
  const toolPages = new Set(liveTools().map((tool) => pageFiles.get(routeOf(tool))));
  let pages = 0;
  for (const [route, file] of pageFiles) {
    if (toolPages.has(file) || file === toolRoutePage) continue;
    pages += 1;
    // The uncatalogued table pages (#221) mount it, but no Tool has their id.
    const table = tablePage(file);
    if (table) {
      assert.equal(toolStructuredData({ toolId: table.toolId, name: "x", description: "y" }, ORIGIN), null, route);
    } else {
      assert.equal(mounts(file), 0, route);
    }
  }
  // The homepage, /categories/, the category pages, /brands/ and the others.
  assert.ok(pageFiles.has("/") && pages > 5, `${pages} other pages`);
});

test("the component renders one script tag, escaped", () => {
  const component = source("../components/StructuredData.tsx");
  assert.equal(component.match(/application\/ld\+json/g)?.length, 1);
  assert.match(component, /serializeJsonLd\(/);
});

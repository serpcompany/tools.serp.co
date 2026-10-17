import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { handlerFor, scanPageHandlers } from "../scripts/lib/tool-sweep.mjs";
import { prefersServerConversion } from "./capabilities.ts";
import { activeTools } from "./catalog/catalog.ts";
import { categoryPageCount, categoryPageHref } from "./catalog/category-pages.ts";
import { directoryCategories } from "./catalog/directory.ts";
import {
  TOOLS_WITH_OWN_PAGE,
  buildBrandsMetadata,
  buildCategoriesIndexMetadata,
  buildCategoryMetadata,
  buildToolMetadata,
} from "./metadata.ts";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_TARGET,
  HOME_TITLE,
  TITLE_TEMPLATE,
  buildHomeMetadata,
  buildSiteMetadata,
  composeDescription,
  fitSentences,
} from "./page-metadata.ts";
import { SHARE_IMAGES, SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from "./share-images.ts";
import { buildTableConvertMetadata } from "./table-convert.ts";
import { TABLE_CONVERT_PAGES } from "./table-convert-pages.ts";

const IN_BROWSER = "It runs in your browser";
// Ahrefs reports a description under 110 characters as too short.
const DESCRIPTION_MIN = 110;

const handlers = scanPageHandlers(fileURLToPath(new URL("../app", import.meta.url)));
const handlerOf = (tool) => handlerFor(tool, handlers);
// Table converter pages build their metadata in lib/table-convert.ts.
const toolsWithToolMetadata = activeTools().filter((tool) => handlerOf(tool) !== "TableConvertLanding");

// Every page the catalog serves, with the metadata it renders.
function servedPages() {
  const pages = [
    ...toolsWithToolMetadata.map((tool) => ({ id: tool.id, tool, metadata: buildToolMetadata(tool.id) })),
    ...TABLE_CONVERT_PAGES.map((page) => ({ id: `table ${page.slug}`, metadata: buildTableConvertMetadata(page) })),
    ...directoryCategories().flatMap((category) =>
      Array.from({ length: categoryPageCount(category.count) }, (_, index) => ({
        id: `category ${category.id} ${index + 1}`,
        metadata: buildCategoryMetadata(category.id, index + 1),
      })),
    ),
    { id: "categories", metadata: buildCategoriesIndexMetadata() },
    { id: "brands", metadata: buildBrandsMetadata(38) },
    { id: "home", metadata: buildHomeMetadata() },
  ];
  return pages;
}

const pages = servedPages();

test("every page's description fits what search results show, and no two pages share one", () => {
  const seen = new Map();
  for (const { id, metadata } of pages) {
    const { description } = metadata;
    assert.ok(description.length <= DESCRIPTION_MAX, `${id}: ${description.length} > ${DESCRIPTION_MAX}`);
    assert.ok(description.length >= DESCRIPTION_MIN, `${id}: ${description.length} < ${DESCRIPTION_MIN}`);
    assert.match(description, /[.!?…]$/, `${id} ends mid-sentence`);
    assert.equal(seen.get(description), undefined, `${id} repeats ${seen.get(description)}'s description`);
    seen.set(description, id);
    assert.equal(metadata.openGraph.description, description, id);
    assert.equal(metadata.twitter.description, description, id);
  }
});

test("a Tool without curated content gets a description of 120 to 160 characters", () => {
  const generated = toolsWithToolMetadata.filter((tool) => !tool.content);
  assert.ok(generated.length > 2000);
  for (const tool of generated) {
    const { description } = buildToolMetadata(tool.id);
    assert.ok(
      description.length >= DESCRIPTION_TARGET && description.length <= DESCRIPTION_MAX,
      `${tool.id}: ${description.length} characters`,
    );
  }
});

test("every template sets og:image and twitter:image to a 1200x630 share image", () => {
  const paths = new Set(Object.values(SHARE_IMAGES).map((image) => image.path));
  const site = buildSiteMetadata();
  for (const { id, metadata } of [...pages, { id: "layout", metadata: site }]) {
    for (const [tag, images] of [
      ["og:image", metadata.openGraph?.images],
      ["twitter:image", metadata.twitter?.images],
    ]) {
      assert.equal(images?.length, 1, `${id} has no ${tag}`);
      const [image] = images;
      assert.ok(paths.has(image.url), `${id}: ${tag} ${image.url} isn't a share image`);
      assert.equal(image.width, SHARE_IMAGE_WIDTH, id);
      assert.equal(image.height, SHARE_IMAGE_HEIGHT, id);
      assert.match(image.alt, /^SERP Tools: /, id);
    }
    assert.equal(metadata.twitter.card, "summary_large_image", id);
  }
});

test("each page family shows its own share image", () => {
  const imageOf = (metadata) => metadata.openGraph.images[0].url;
  assert.equal(imageOf(buildToolMetadata("mp4-to-mp3")), SHARE_IMAGES.convert.path);
  assert.equal(imageOf(buildToolMetadata("compress-mp4")), SHARE_IMAGES.compress.path);
  assert.equal(imageOf(buildToolMetadata("download-tiktok-videos")), SHARE_IMAGES.download.path);
  assert.equal(imageOf(buildToolMetadata("pdf-reader")), SHARE_IMAGES.pdf.path);
  assert.equal(imageOf(buildTableConvertMetadata(TABLE_CONVERT_PAGES[0])), SHARE_IMAGES.convert.path);
  assert.equal(imageOf(buildCategoryMetadata("download")), SHARE_IMAGES.download.path);
  assert.equal(imageOf(buildHomeMetadata()), SHARE_IMAGES.default.path);
});

test("titles are the page's own: the layout's template adds the site name once", () => {
  assert.deepEqual(buildSiteMetadata().title, { default: HOME_TITLE, template: TITLE_TEMPLATE });
  assert.equal(TITLE_TEMPLATE, "%s | SERP Tools");
  assert.equal(buildToolMetadata("png-to-jpg").title, "PNG to JPG");
  assert.equal(buildToolMetadata("download-tiktok-videos").title, "TikTok Video Downloader");
  assert.equal(buildCategoryMetadata("convert").title, "Convert Tools");
  assert.equal(buildCategoriesIndexMetadata().title, "Categories");
  for (const { id, metadata } of pages.filter((page) => page.id !== "home")) {
    assert.equal(typeof metadata.title, "string", id);
    assert.doesNotMatch(metadata.title, /SERP Tools/, `${id} names the site in its own title`);
  }
});

test("the homepage has a full title and tags, and leaves its canonical and og:url to the page", () => {
  const home = buildHomeMetadata();
  assert.deepEqual(home.title, { absolute: HOME_TITLE });
  assert.ok(HOME_TITLE.length >= 30 && HOME_TITLE.length <= 60, `${HOME_TITLE.length} characters`);
  assert.ok(home.description.length >= DESCRIPTION_TARGET);
  assert.equal(home.alternates, undefined);
  assert.equal(home.openGraph.url, undefined);
  assert.equal(home.openGraph.type, "website");
  assert.equal(home.twitter.card, "summary_large_image");

  const homeSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(homeSource, /export const metadata = buildHomeMetadata\(\)/);
  assert.match(homeSource, /<link rel="canonical" href=\{siteOrigin\} \/>/);
  assert.match(homeSource, /<meta property="og:url" content=\{siteOrigin\} \/>/);
});

test("category pages are titled and canonical for themselves", () => {
  const convert = directoryCategories().find((category) => category.id === "convert");
  const pageCount = categoryPageCount(convert.count);
  assert.ok(pageCount > 2);
  const second = buildCategoryMetadata("convert", 2);
  assert.equal(second.title, `Convert Tools, page 2 of ${pageCount}`);
  assert.equal(second.alternates.canonical, categoryPageHref("convert", 2));
  assert.equal(second.openGraph.url, categoryPageHref("convert", 2));
  assert.match(second.description, new RegExp(` Page 2 of ${pageCount}\\.$`));
  assert.equal(buildCategoryMetadata("convert").alternates.canonical, "/category/convert/");
  assert.deepEqual(buildCategoryMetadata("convert", pageCount + 1), {});
  assert.deepEqual(buildCategoryMetadata("not-a-category"), {});
});

test("a description says the file stays in the browser only where the page keeps it there", () => {
  for (const tool of toolsWithToolMetadata) {
    const { description } = buildToolMetadata(tool.id);
    if (!description.includes(IN_BROWSER)) continue;
    assert.equal(handlerOf(tool), "ToolPageRenderer", `${tool.id} isn't on the converter page`);
    if (tool.operation === "convert") {
      assert.equal(prefersServerConversion(tool.from, tool.to), false, `${tool.id} tries the server first`);
    }
  }
  assert.match(buildToolMetadata("3gp-to-hevc").description, new RegExp(IN_BROWSER));
  assert.match(buildToolMetadata("png-to-jpg").description, new RegExp(IN_BROWSER));
  // Server first: /api/video-convert, /api/pdf-compress.
  assert.doesNotMatch(buildToolMetadata("mp4-to-rm").description, /browser/);
  assert.doesNotMatch(buildToolMetadata("amr-to-ogg").description, /browser/);
  assert.doesNotMatch(buildToolMetadata("compress-pdf").description, /browser/);
  // Transcription has its own page.
  assert.doesNotMatch(buildToolMetadata("mp3-to-transcript").description, /browser|Choose your/);
});

test("TOOLS_WITH_OWN_PAGE lists the converters whose route isn't the converter page", () => {
  const ownPage = activeTools()
    .filter((tool) => tool.operation === "convert" || tool.operation === "compress")
    .filter((tool) => !["ToolPageRenderer", "TableConvertLanding"].includes(handlerOf(tool)))
    .map((tool) => tool.id)
    .sort();
  assert.deepEqual([...TOOLS_WITH_OWN_PAGE].sort(), ownPage);
});

test("placeholder Tools and categories say the editor is coming soon", () => {
  const placeholders = activeTools().filter((tool) => handlerOf(tool) === "ToolPlaceholder");
  assert.equal(placeholders.length, 3);
  for (const tool of placeholders) {
    assert.match(buildToolMetadata(tool.id).description, /coming soon/, tool.id);
    assert.match(buildCategoryMetadata(tool.operation).description, /coming soon/, tool.operation);
  }
  for (const tool of toolsWithToolMetadata.filter((tool) => handlerOf(tool) !== "ToolPlaceholder")) {
    assert.doesNotMatch(buildToolMetadata(tool.id).description, /coming soon/, tool.id);
  }
});

test("long curated text is cut at a sentence, never mid-word", () => {
  // m4p-to-mp3's curated subtitle is 211 characters.
  const m4p = buildToolMetadata("m4p-to-mp3").description;
  assert.match(m4p, /^Convert an unprotected M4P file to MP3 in your browser\. /);
  assert.doesNotMatch(m4p, /FairPlay/);

  assert.equal(fitSentences("One two"), "One two.");
  assert.equal(fitSentences(`${"a".repeat(100)}. ${"b".repeat(100)}.`), `${"a".repeat(100)}.`);
  const words = fitSentences("word ".repeat(60));
  assert.ok(words.length <= DESCRIPTION_MAX);
  assert.match(words, /word…$/);
});

test("facts are added only while a description is short, and only when they fit", () => {
  assert.equal(composeDescription("Short lead", ["Fact one.", "Fact two."]), "Short lead. Fact one. Fact two.");
  const long = `${"x".repeat(125)}.`;
  assert.equal(composeDescription(long, ["Fact one."]), long);
  const near = `${"x".repeat(100)}.`;
  assert.equal(
    composeDescription(near, [["y".repeat(70), "Short alternative."]]),
    `${near} Short alternative.`,
  );
});

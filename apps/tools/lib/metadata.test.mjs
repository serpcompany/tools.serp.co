import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { handlerFor, scanPageHandlers } from "../scripts/lib/tool-sweep.mjs";
import { prefersServerConversion } from "./capabilities.ts";
import { usesWebCodecs } from "./convert/webcodecs.ts";
import { formatName } from "./format-names.ts";
import { activeTools } from "./catalog/catalog.ts";
import { categoryPageCount, categoryPageHref } from "./catalog/category-pages.ts";
import { directoryCategories } from "./catalog/directory.ts";
import {
  TOOLS_WITH_OWN_PAGE,
  buildBrandsMetadata,
  buildCategoriesIndexMetadata,
  buildCategoryMetadata,
  buildToolMetadata,
  hasToolSeo,
  indefiniteArticle,
  isTranscriptionTool,
  runsInBrowser,
  servedTitleLength,
  toolHeading,
  toolDescription,
  toolSeo,
} from "./metadata.ts";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_TARGET,
  HOME_DESCRIPTION,
  HOME_TITLE,
  SITE_NAME,
  TITLE_TEMPLATE,
  buildHomeMetadata,
  buildSiteMetadata,
  composeDescription,
  fitSentences,
} from "./page-metadata.ts";
import { SHARE_IMAGES, SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from "./share-images.ts";
import { buildTableConvertDemoMetadata, buildTableConvertMetadata } from "./table-convert.ts";
import { TABLE_CONVERT_PAGES } from "./table-convert-pages.ts";
import { buildConverterFaqs, buildHowToSection, buildInfoArticleSection } from "./tool-sections.ts";
import { buildVideosMetadata, buildWatchMetadata, watchVideos } from "./videos.ts";

const IN_BROWSER = "It runs in your browser";
// Ahrefs reports a description under 110 characters as too short.
const DESCRIPTION_MIN = 110;

const handlers = scanPageHandlers(fileURLToPath(new URL("../app", import.meta.url)));
const handlerOf = (tool) => handlerFor(tool, handlers);
// The Tools whose description toolFacts builds: table converter pages take
// theirs from lib/table-convert.ts.
const toolsWithToolMetadata = activeTools().filter((tool) => handlerOf(tool) !== "TableConvertLanding");
const activeIds = new Set(activeTools().map((tool) => tool.id));

// Every page the catalog serves, with the metadata it renders. A live
// table converter's page builds it like any Tool's; the table converter
// folders with no live Tool keep buildTableConvertMetadata.
function servedPages() {
  const pages = [
    ...activeTools().map((tool) => ({ id: tool.id, tool, metadata: buildToolMetadata(tool.id) })),
    ...TABLE_CONVERT_PAGES.filter((page) => !activeIds.has(page.slug)).map((page) => ({
      id: `table ${page.slug}`,
      metadata: buildTableConvertMetadata(page),
    })),
    ...directoryCategories().flatMap((category) =>
      Array.from({ length: categoryPageCount(category.count) }, (_, index) => ({
        id: `category ${category.id} ${index + 1}`,
        metadata: buildCategoryMetadata(category.id, index + 1),
      })),
    ),
    { id: "table converter demo", metadata: buildTableConvertDemoMetadata() },
    { id: "categories", metadata: buildCategoriesIndexMetadata() },
    { id: "brands", metadata: buildBrandsMetadata(38) },
    { id: "home", metadata: buildHomeMetadata() },
    ...watchVideos("https://tools.serp.co").map((video) => ({
      id: `watch ${video.watchPath}`,
      metadata: buildWatchMetadata(video),
    })),
    { id: "videos", metadata: buildVideosMetadata() },
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
  // Wave A (#358) and later waves curate the biggest Tools; thousands stay generated.
  assert.ok(generated.length > 1000);
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
  assert.equal(imageOf(buildToolMetadata("batch-compress-png")), SHARE_IMAGES.compress.path);
  assert.equal(imageOf(buildCategoryMetadata("bulk")), SHARE_IMAGES.compress.path);
  assert.equal(imageOf(buildToolMetadata("download-tiktok-videos")), SHARE_IMAGES.download.path);
  assert.equal(imageOf(buildToolMetadata("pdf-reader")), SHARE_IMAGES.pdf.path);
  assert.equal(imageOf(buildTableConvertMetadata(TABLE_CONVERT_PAGES[0])), SHARE_IMAGES.convert.path);
  assert.equal(imageOf(buildCategoryMetadata("download")), SHARE_IMAGES.download.path);
  assert.equal(imageOf(buildHomeMetadata()), SHARE_IMAGES.default.path);
  assert.equal(imageOf(buildVideosMetadata()), SHARE_IMAGES.videos.path);
  for (const video of watchVideos("https://tools.serp.co")) {
    assert.equal(imageOf(buildWatchMetadata(video)), SHARE_IMAGES.videos.path, video.watchPath);
  }
});

test("titles are the page's own: the layout's template adds the site name once", () => {
  assert.deepEqual(buildSiteMetadata().title, { default: SITE_NAME, template: TITLE_TEMPLATE });
  assert.equal(TITLE_TEMPLATE, "%s | SERP Tools");
  assert.equal(buildToolMetadata("png-to-jpg").title, "Convert PNG to JPG Online (Free)");
  assert.equal(buildToolMetadata("download-tiktok-videos").title, "TikTok Video Downloader");
  assert.equal(buildCategoryMetadata("convert").title, "Convert Tools");
  assert.equal(buildCategoriesIndexMetadata().title, "Categories");
  for (const { id, metadata } of pages.filter((page) => page.id !== "home")) {
    assert.equal(typeof metadata.title, "string", id);
    assert.doesNotMatch(metadata.title, /SERP Tools/, `${id} names the site in its own title`);
  }
});

test("converter and compressor titles and H1s follow the owner's pattern, or the Tool's content.seo", () => {
  const seo = (id) => [buildToolMetadata(id).title, toolHeading(id)];
  assert.deepEqual(seo("png-to-jpg"), ["Convert PNG to JPG Online (Free)", "PNG to JPG Converter"]);
  assert.deepEqual(seo("compress-m4a"), ["Compress M4A Files Online (Free)", "M4A Compressor"]);
  assert.deepEqual(seo("png-to-png"), ["Compress PNG Files Online (Free)", "PNG Compressor"]);
  assert.deepEqual(seo("csv-to-json"), ["Convert CSV to JSON Online (Free)", "CSV to JSON Converter"]);
  // A converter whose name isn't a pair keeps it as its title, as staging serves it.
  assert.deepEqual(seo("character-counter"), ["Character Counter", "Character Counter"]);
  // Titles count the layout's " | SERP Tools": these two drop " Online (Free)".
  assert.deepEqual(seo("markdown-to-pandasdataframe"), ["Convert Markdown to Pandas DataFrame", "Markdown to Pandas DataFrame Converter"]);
  assert.deepEqual(seo("markdown-to-restructuredtext"), ["Convert Markdown to reStructuredText", "Markdown to reStructuredText Converter"]);
  // A compressor names its format as the format reference does, whatever the
  // catalog name's casing (WEBP Compressor).
  assert.deepEqual(seo("compress-webp"), ["Compress WebP Files Online (Free)", "WebP Compressor"]);
  assert.deepEqual(seo("compress-webm"), ["Compress WebM Files Online (Free)", "WebM Compressor"]);
  // Downloaders and the other operations keep their own titles.
  assert.equal(buildToolMetadata("download-tiktok-videos").title, "TikTok Video Downloader");

  const curated = activeTools().filter((tool) => hasToolSeo(tool) && tool.content?.seo);
  assert.ok(curated.length >= 2, "the examples batch is applied");
  for (const tool of curated) {
    assert.deepEqual(seo(tool.id), [tool.content.seo.title, tool.content.seo.h1], tool.id);
    assert.equal(buildToolMetadata(tool.id).description, tool.content.seo.description, tool.id);
  }

  const titles = new Set();
  for (const tool of activeTools().filter(hasToolSeo)) {
    const { title, h1 } = toolSeo(tool);
    assert.ok(servedTitleLength(title) <= 60, `${tool.id}: ${title} | SERP Tools`);
    // The default: the verb phrase over the noun phrase. A writer's
    // content.seo follows the Tool's keyword instead.
    if (!tool.content?.seo && tool.operation === "compress") {
      assert.match(title, /^Compress .+ Files( Online \(Free\))?$/, tool.id);
      assert.equal(h1, `${formatName(tool.from)} Compressor`, tool.id);
    } else if (!tool.content?.seo && / to /.test(tool.name)) {
      assert.match(title, /^Convert .+ to .+?( Online \(Free\))?$/, tool.id);
      assert.equal(h1, `${tool.name} Converter`, tool.id);
    }
    assert.ok(!titles.has(title), `${tool.id} repeats the title ${title}`);
    titles.add(title);
  }
});

test("the layout's defaults are the site's, not a copy of the homepage's head", () => {
  const site = buildSiteMetadata();
  assert.equal(site.title.default, "SERP Tools");
  assert.notEqual(site.title.default, HOME_TITLE);
  assert.notEqual(site.description, HOME_DESCRIPTION);
  assert.equal(buildHomeMetadata().description, HOME_DESCRIPTION);
});

// A page that exports no metadata falls back to the layout's defaults. The
// 404s are no page.tsx: Next renders its built-in not-found boundary (the app
// has no not-found.tsx) with those defaults and a robots noindex tag, so they
// are outside this scan. internal/ is the 401-gated dashboard.
test("every public page.tsx exports metadata or generateMetadata", () => {
  const appDir = new URL("../app/", import.meta.url);
  const files = readdirSync(appDir, { recursive: true })
    .filter((file) => file === "page.tsx" || file.endsWith("/page.tsx"))
    .filter((file) => !file.startsWith("internal/"));
  assert.ok(files.length > 250, `${files.length} pages`);
  const missing = files.filter(
    (file) =>
      !/^export (?:const|(?:async )?function) (?:metadata|generateMetadata)\b/m.test(
        readFileSync(new URL(file, appDir), "utf8"),
      ),
  );
  assert.deepEqual(missing, []);
  assert.equal(
    readdirSync(appDir, { recursive: true }).some((file) => /(^|\/)not-found\.tsx$/.test(file)),
    false,
    "a not-found.tsx exists: check its metadata and noindex, then update this test",
  );
});

test("the table converter demo has its own title and image, and no canonical", () => {
  const demo = buildTableConvertDemoMetadata();
  assert.equal(demo.title, "Table Converter Demo");
  assert.equal(demo.alternates, undefined);
  assert.equal(demo.openGraph.url, undefined);
  assert.equal(demo.openGraph.images[0].url, SHARE_IMAGES.convert.path);
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
      const serverFirst = prefersServerConversion(tool.from, tool.to) && !usesWebCodecs(tool.from, tool.to);
      assert.equal(serverFirst, false, `${tool.id} tries the server first`);
    }
  }
  assert.match(buildToolMetadata("3gp-to-hevc").description, new RegExp(IN_BROWSER));
  assert.match(buildToolMetadata("svg-to-bmp").description, new RegExp(IN_BROWSER));
  // Server first: /api/video-convert, /api/pdf-compress.
  assert.doesNotMatch(buildToolMetadata("mov-to-rm").description, /browser/);
  assert.doesNotMatch(buildToolMetadata("amr-to-ogg").description, /browser/);
  assert.doesNotMatch(buildToolMetadata("compress-pdf").description, /browser/);
  // Transcription has its own page.
  assert.doesNotMatch(buildToolMetadata("mp3-to-transcript").description, /browser|Choose your/);
});

test("a converter page's How-to heading is the question people search, with a or an as the format is said", () => {
  // The generated heading, without any written content.seo.howToHeading.
  const heading = (id) => {
    const tool = activeTools().find((entry) => entry.id === id);
    const seo = tool.content?.seo && { ...tool.content.seo, howToHeading: undefined };
    return buildHowToSection(tool.content ? { ...tool, content: { ...tool.content, seo } } : tool).title;
  };
  assert.equal(heading("png-to-pdf"), "How to convert PNG to PDF");
  assert.equal(heading("webp-to-png"), "How to convert WebP to PNG");
  assert.equal(heading("compress-mp4"), "How to compress an MP4 file");
  assert.equal(heading("compress-m4a"), "How to compress an M4A file");
  assert.equal(heading("png-to-png"), "How to compress a PNG file");
  assert.equal(heading("compress-webp"), "How to compress a WebP file");
  // A writer's content.seo.howToHeading replaces the generated one.
  const webp = activeTools().find((tool) => tool.id === "webp-to-png");
  const written = { ...webp, content: { ...webp.content, seo: { ...webp.content.seo, howToHeading: "How do I convert a WebP to a PNG?" } } };
  assert.equal(buildHowToSection(written).title, "How do I convert a WebP to a PNG?");
  const article = (format) => `${indefiniteArticle(format)} ${format}`;
  assert.deepEqual(
    ["MP4", "M4A", "MKV", "FLV", "SVG", "AAC", "AVIF", "OGG", "MP3", "PNG", "MOV", "FLAC", "GIF", "WEBM", "JPEG", "PDF"].map(article),
    ["an MP4", "an M4A", "an MKV", "an FLV", "an SVG", "an AAC", "an AVIF", "an OGG", "an MP3", "a PNG", "a MOV", "a FLAC", "a GIF", "a WEBM", "a JPEG", "a PDF"],
  );
  // Other pages keep their headings: Batch PNG Compressor isn't on the converter page.
  assert.equal(heading("batch-compress-png"), "How to compress PNG files");
});

test("AV1 to RM runs in the browser: workerClient takes the WebCodecs path before any server route", () => {
  const tool = activeTools().find((candidate) => candidate.id === "av1-to-rm");
  assert.ok(tool, "av1-to-rm is live");
  assert.equal(prefersServerConversion(tool.from, tool.to), true);
  assert.equal(runsInBrowser(tool), true);
  assert.match(buildToolMetadata("av1-to-rm").description, new RegExp(IN_BROWSER));
  const copy = JSON.stringify([buildInfoArticleSection(tool), buildConverterFaqs(tool)]);
  assert.doesNotMatch(copy, /SERP Tools server/);
  assert.match(copy, /Runs in your browser: the file isn't uploaded\./);
  // MP4 to RM has no WebCodecs step, so it still tries the server first.
  assert.equal(runsInBrowser(activeTools().find((candidate) => candidate.id === "mp4-to-rm")), false);
});

test("transcription Tools keep the title, H1 and description production serves", () => {
  // The rule: audio or video in, txt out. It covers exactly the pages that
  // render TranscribeTool.
  const transcribePages = readdirSync(fileURLToPath(new URL("../app", import.meta.url)), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try {
        return readFileSync(fileURLToPath(new URL(`../app/${entry.name}/page.tsx`, import.meta.url)), "utf8").includes(
          "<TranscribeTool",
        );
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
  const transcription = activeTools().filter(isTranscriptionTool);
  assert.deepEqual(transcription.map((tool) => tool.id).sort(), transcribePages);
  assert.equal(transcription.length, 8);
  for (const tool of transcription) {
    assert.equal(hasToolSeo(tool), false, tool.id);
    const metadata = buildToolMetadata(tool.id);
    assert.equal(metadata.title, tool.content?.tool.title ?? tool.name, tool.id);
    assert.equal(metadata.description, toolDescription(tool), tool.id);
    assert.doesNotMatch(metadata.title, /Convert|Free/, tool.id);
  }
  // OCR and text-to-image Tools aren't transcription.
  for (const id of ["jpg-to-txt", "pdf-to-txt", "txt-to-pdf"]) {
    assert.equal(isTranscriptionTool(activeTools().find((tool) => tool.id === id)), false, id);
  }
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
  // m4p-to-mp3's curated subtitle before its in-depth copy (#372): 211 characters.
  const subtitle =
    "Convert an unprotected M4P file to MP3 in your browser. Songs copy-protected by Apple's FairPlay (Apple Music downloads, most iTunes Store songs bought before 2009) can't be converted, and the converter says so.";
  const tool = activeTools().find((entry) => entry.id === "m4p-to-mp3");
  const m4p = toolDescription({ ...tool, content: { ...tool.content, tool:{ ...tool.content.tool, subtitle } } });
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

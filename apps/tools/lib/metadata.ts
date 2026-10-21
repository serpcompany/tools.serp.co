import type { Metadata } from "next";

import type { Tool, ToolSeo } from "@/types";

import { AUDIO_FORMATS, VIDEO_FORMATS, prefersServerConversion } from "./capabilities.ts";
import { activeTools, getTool } from "./catalog/catalog.ts";
import { categoryPageHref } from "./catalog/category-pages.ts";
import { categoryPage, directoryCategories, type CategoryPage } from "./catalog/directory.ts";
import { CATEGORY_CONTENT, isToolOperation, type ToolOperation } from "./catalog/operations.ts";
import { resolveCompressionTarget } from "./compression-utils.ts";
import { usesWebCodecs } from "./convert/webcodecs.ts";
import {
  DESCRIPTION_MAX,
  FREE,
  composeDescription,
  pageMetadata,
  type Fact,
} from "./page-metadata.ts";
import type { ShareImageName } from "./share-images.ts";
import { normalizePath } from "./sitemap.ts";
import { tableConvertDescription } from "./table-convert.ts";
import { TABLE_CONVERT_PAGES } from "./table-convert-pages.ts";

// The catalog's pages' metadata: Tools, categories, /categories/ and
// /brands/, built with lib/page-metadata.ts (issue #320).

// Sentences a description may add after its lead, each true wherever it is
// used (see toolFacts).
const IN_BROWSER = "It runs in your browser, so the file stays on your device.";
// VideoDownloaderTool's link field.
const PASTE_LINK: Fact = [
  "Paste a public video link to start the download.",
  "Paste a public video link to start.",
];
// PdfTool's toolbar, in both its view and edit modes.
const PDF_TOOLBAR = "Use the toolbar to open a PDF, annotate it and download a copy.";

// Each operation's share image: its category page and its Tools use it.
const OPERATION_IMAGES: Record<ToolOperation, ShareImageName> = {
  convert: "convert",
  download: "download",
  compress: "compress",
  combine: "default",
  bulk: "compress",
  edit: "pdf",
  "video-editor": "default",
  "image-editor": "default",
  "audio-editor": "default",
  view: "pdf",
};

// The *-editor operations hold one "coming soon" placeholder each: the Tool
// route renders ToolPlaceholder for them (app/(convert)/[tool]/page.tsx), so
// their descriptions say so instead of the registry's.
const PLACEHOLDER_MEDIA: Partial<Record<ToolOperation, string>> = {
  "video-editor": "video",
  "image-editor": "image",
  "audio-editor": "audio",
};

// Converter Tools whose route has a page of its own instead of the converter
// page (ToolPageRenderer), such as the transcription pages. What the converter
// page does isn't said of them. metadata.test.mjs derives this list from app/
// and fails when it drifts.
export const TOOLS_WITH_OWN_PAGE: ReadonlySet<string> = new Set([
  "audio-to-text",
  "audio-to-transcript",
  "character-counter",
  "html-to-markdown",
  "json-to-csv",
  "mp3-to-transcript",
  "mp4-to-transcript",
  "tiktok-to-transcript",
  "video-to-transcript",
  "youtube-to-transcript",
  "youtube-to-transcript-generator",
]);

// The compression targets compressFile (lib/convert/workerClient.ts) runs in
// the browser. PDF and HEIC or HEIF go to a server route.
const BROWSER_COMPRESSION_TARGETS: ReadonlySet<string> = new Set([
  "image-worker",
  "image-browser",
  "audio",
  "video",
]);

// A format as the Tool's name writes it ("WebP", "Excel"), else upper case.
function formatLabel(tool: Tool, format: string): string {
  const escaped = format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tool.name.match(new RegExp(`\\b${escaped}\\b`, "i"))?.[0] ?? format.toUpperCase();
}

// The table converters on TableConvertLanding pages. HTML to Markdown and
// JSON to CSV are listed with them but have pages of their own.
const TABLE_CONVERTERS: ReadonlySet<string> = new Set(
  TABLE_CONVERT_PAGES.map((page) => page.slug).filter((slug) => !TOOLS_WITH_OWN_PAGE.has(slug)),
);

// Whether the converter page (ToolPageRenderer) serves the Tool: the Tool
// route renders it for converters and compressors with both formats, except
// those with a page of their own and the table converters.
export function onConverterPage(tool: Tool): tool is Tool & { from: string; to: string } {
  return (
    (tool.operation === "convert" || tool.operation === "compress") &&
    Boolean(tool.from && tool.to) &&
    !TOOLS_WITH_OWN_PAGE.has(tool.id) &&
    !TABLE_CONVERTERS.has(tool.id)
  );
}

// Whether the converter page keeps the file in the browser: no server route
// is tried first (lib/convert/workerClient.ts). The WebCodecs path (AV1 and
// HEVC) runs before the server check there, so AV1 to RM stays in the browser.
export function runsInBrowser(tool: Tool & { from: string; to: string }): boolean {
  if (tool.operation === "compress") {
    return BROWSER_COMPRESSION_TARGETS.has(resolveCompressionTarget(tool.from));
  }
  return usesWebCodecs(tool.from, tool.to) || !prefersServerConversion(tool.from, tool.to);
}

function toolFacts(tool: Tool, lead: string): Fact[] {
  const free: Fact = /\bfree\b/i.test(lead) ? [] : FREE;
  if (tool.operation === "download") return [PASTE_LINK];
  if (tool.operation === "view" || tool.operation === "edit") return [PDF_TOOLBAR, free];
  if (!onConverterPage(tool)) return [free];

  const from = formatLabel(tool, tool.from);
  const steps =
    tool.operation === "compress"
      ? `Choose your ${from} file, then download the compressed copy.`
      : `Choose your ${from} file, then download it as ${formatLabel(tool, tool.to)}.`;
  const location = runsInBrowser(tool) && !/\bbrowser\b/i.test(lead) ? [IN_BROWSER] : [];
  return [location, free, steps];
}

// A Tool's description: its curated subtitle or registry description, then
// facts about the page that serves it. A placeholder says it is coming soon.
export function toolDescription(tool: Tool): string {
  const media = PLACEHOLDER_MEDIA[tool.operation];
  if (media) {
    return `The ${tool.name.toLowerCase()} is coming soon to SERP Tools. Until then, convert or compress your ${media} files with the free ${media} converters and compressors.`;
  }
  if (TABLE_CONVERTERS.has(tool.id) && tool.from && tool.to) {
    return tableConvertDescription(tool.from, tool.to);
  }
  const lead = tool.content?.tool.subtitle ?? tool.description;
  return composeDescription(lead, toolFacts(tool, lead));
}

// Converters and compressors take their title, H1 and description from
// content.seo, which a writer words around the Tool's keyword, else from the
// default pattern (#356), shaped by how people search each operation: the
// title is the verb phrase, the H1 the noun phrase. "Convert WebP to PNG
// Online (Free)" over an H1 of "WebP to PNG Converter", and "Compress MP4
// Files Online (Free)" over "MP4 Compressor". A title that would pass 60
// characters drops " Online (Free)". A name that isn't a pair, such as
// Character Counter, keeps the name. docs/converter-copy.md has the rules
// `pnpm content:check` holds every one of them to.
export const SEO_TITLE_MAX = 60;
const TITLE_SUFFIX = " Online (Free)";

// Transcription Tools turn audio or video into a text transcript. The owner
// names them in their own issue, so this PR leaves their title, H1 and
// description as production serves them (owner decision on #356): no pattern,
// no content.seo, no content:check.
const MEDIA_FORMATS: ReadonlySet<string> = new Set([...AUDIO_FORMATS, ...VIDEO_FORMATS]);
export function isTranscriptionTool(tool: Tool): boolean {
  return tool.operation === "convert" && tool.to === "txt" && MEDIA_FORMATS.has(tool.from ?? "");
}

export function hasToolSeo(tool: Tool): boolean {
  return (tool.operation === "convert" || tool.operation === "compress") && !isTranscriptionTool(tool);
}

// The format a compressor names: "M4A" for M4A Compressor.
function compressedFormat(tool: Tool): string {
  return tool.name.match(/^(.+) Compressor$/)?.[1] ?? formatLabel(tool, tool.from ?? "");
}

const isPair = (tool: Tool) => / to /.test(tool.name);

function generatedH1(tool: Tool): string {
  if (tool.operation === "compress") return `${compressedFormat(tool)} Compressor`;
  return isPair(tool) ? `${tool.name} Converter` : tool.name;
}

function generatedTitle(tool: Tool, h1: string): string {
  let stem = h1;
  if (tool.operation === "compress") stem = `Compress ${compressedFormat(tool)} Files`;
  else if (isPair(tool)) stem = `Convert ${tool.name}`;
  return `${stem}${TITLE_SUFFIX}`.length <= SEO_TITLE_MAX ? `${stem}${TITLE_SUFFIX}` : stem;
}

// "a" or "an" before a format as it is said: "an MP4", "an M4A", "an AVIF",
// "a MOV", "a PNG". An initialism is read letter by letter, so one that
// starts with F, H, L, M, N, R, S or X and then a consonant or digit takes
// "an"; FLAC is said as a word.
const SAID_AS_WORDS: ReadonlySet<string> = new Set(["FLAC"]);
export function indefiniteArticle(format: string): "a" | "an" {
  const upper = format.toUpperCase();
  if (/^[AEIOU]/.test(upper)) return "an";
  if (/^[FHLMNRSX][^AEIOU]/.test(upper) && !SAID_AS_WORDS.has(upper)) return "an";
  return "a";
}

// The How-to heading of a converter page: the question people search.
// "How to convert WebP to PNG", "How to compress an MP4 file".
export function howToHeading(tool: Tool): string | undefined {
  if (tool.operation === "compress") {
    const format = compressedFormat(tool);
    return `How to compress ${indefiniteArticle(format)} ${format} file`;
  }
  return isPair(tool) ? `How to convert ${tool.name}` : undefined;
}

export function toolSeo(tool: Tool): ToolSeo {
  const curated = tool.content?.seo;
  const h1 = curated?.h1 ?? generatedH1(tool);
  return {
    title: curated?.title ?? generatedTitle(tool, h1),
    h1,
    description: curated?.description ?? toolDescription(tool),
  };
}

// A converter or compressor page's H1, for the pages with their own folder.
export function toolHeading(toolId: string): string {
  const tool = getTool(toolId);
  if (!tool) throw new Error(`${toolId} is not a Tool`);
  return toolSeo(tool).h1;
}

export function buildToolMetadata(toolId: string): Metadata {
  const tool = getTool(toolId);
  if (!tool) {
    return {};
  }

  const seo = hasToolSeo(tool) ? toolSeo(tool) : undefined;
  return pageMetadata({
    title: seo?.title ?? tool.content?.tool.title ?? tool.name,
    description: seo?.description ?? toolDescription(tool),
    canonical: tool.route ? normalizePath(tool.route) : undefined,
    image: OPERATION_IMAGES[tool.operation],
  });
}

// A category's description, then, from page 2, which page this is. The
// placeholder categories say their editor is coming soon, whatever
// CATEGORY_CONTENT promises.
function categoryDescription(operation: ToolOperation, listing: CategoryPage): string {
  const media = PLACEHOLDER_MEDIA[operation];
  if (media) {
    return `${listing.category.title}: the SERP Tools ${media} editor is coming soon. Until then, browse the free ${media} converters and compressors on SERP Tools.`;
  }
  const { count } = listing.category;
  const pageNote = listing.page > 1 ? ` Page ${listing.page} of ${listing.pageCount}.` : "";
  const firstTool = listing.tools[0];
  const description = composeDescription(
    CATEGORY_CONTENT[operation].description,
    [
      `Browse ${count.toLocaleString("en-US")} free ${count === 1 ? "tool" : "tools"} on SERP Tools, with no sign-up.`,
      firstTool ? `It includes ${firstTool.name}.` : [],
    ],
    DESCRIPTION_MAX - pageNote.length,
  );
  return `${description}${pageNote}`;
}

// A category page: page 1 is the category itself, page n from 2 its later
// pages (lib/catalog/category-pages.ts), each titled and canonical for itself.
export function buildCategoryMetadata(categoryName: string, page = 1): Metadata {
  if (!isToolOperation(categoryName)) {
    return {};
  }
  const listing = categoryPage(categoryName, page);
  if (!listing) {
    return {};
  }

  const { title } = listing.category;
  return pageMetadata({
    title: listing.page > 1 ? `${title}, page ${listing.page} of ${listing.pageCount}` : title,
    description: categoryDescription(categoryName, listing),
    canonical: normalizePath(categoryPageHref(categoryName, listing.page)),
    image: OPERATION_IMAGES[categoryName],
  });
}

export function buildCategoriesIndexMetadata(): Metadata {
  const categories = directoryCategories().length;
  const tools = activeTools().length.toLocaleString("en-US");
  return pageMetadata({
    title: "Categories",
    description: `Browse all ${categories} SERP Tools categories, from file converters and video downloaders to compressors and PDF tools: ${tools} free tools, with no sign-up.`,
    canonical: normalizePath("/categories/"),
    image: "default",
  });
}

export function buildBrandsMetadata(brandCount: number): Metadata {
  return pageMetadata({
    title: "Brands",
    description: `Browse the ${brandCount} public sites, products and projects in the SERP network, each with its web address and a link that opens it in a new tab.`,
    canonical: normalizePath("/brands/"),
    image: "default",
  });
}

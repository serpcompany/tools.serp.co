import type { Metadata } from "next";

import type { Tool } from "@/types";

import { prefersServerConversion } from "./capabilities.ts";
import { activeTools, getTool } from "./catalog/catalog.ts";
import { categoryPageHref } from "./catalog/category-pages.ts";
import { categoryPage, directoryCategories, type CategoryPage } from "./catalog/directory.ts";
import { CATEGORY_CONTENT, isToolOperation, type ToolOperation } from "./catalog/operations.ts";
import { resolveCompressionTarget } from "./compression-utils.ts";
import {
  DESCRIPTION_MAX,
  FREE,
  composeDescription,
  pageMetadata,
  type Fact,
} from "./page-metadata.ts";
import type { ShareImageName } from "./share-images.ts";
import { normalizePath } from "./sitemap.ts";

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
  bulk: "default",
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

// Whether the converter page (ToolPageRenderer) serves the Tool: the Tool
// route renders it for converters and compressors with both formats.
function onConverterPage(tool: Tool): tool is Tool & { from: string; to: string } {
  return (
    (tool.operation === "convert" || tool.operation === "compress") &&
    Boolean(tool.from && tool.to) &&
    !TOOLS_WITH_OWN_PAGE.has(tool.id)
  );
}

// Whether the converter page keeps the file in the browser: no server route
// is tried first (lib/convert/workerClient.ts).
function runsInBrowser(tool: Tool & { from: string; to: string }): boolean {
  if (tool.operation === "compress") {
    return BROWSER_COMPRESSION_TARGETS.has(resolveCompressionTarget(tool.from));
  }
  return !prefersServerConversion(tool.from, tool.to);
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
  const lead = tool.content?.tool.subtitle ?? tool.description;
  return composeDescription(lead, toolFacts(tool, lead));
}

export function buildToolMetadata(toolId: string): Metadata {
  const tool = getTool(toolId);
  if (!tool) {
    return {};
  }

  return pageMetadata({
    title: tool.content?.tool.title ?? tool.name,
    description: toolDescription(tool),
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

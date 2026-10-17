import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import {
  CATEGORY_PAGE_SIZE,
  categoryPageCount,
  categoryPageHref,
  categoryPageHrefs,
  parseCategoryPage,
} from "./category-pages.ts";
import {
  HOME_TOOLS_PER_CATEGORY,
  LINK_HUB_TAB_LIMIT,
  categoryPage,
  directoryCategories,
  homeCategorySections,
  toolLinkCategories,
  toolSearchIndex,
} from "./directory.ts";
import { categoryHref, toolHref } from "./href.ts";
import { DEFAULT_TOOL_ICON, TOOL_ICON_NAMES, toolIconName } from "./icons.ts";
import { CATEGORY_CONTENT, OPERATION_LABELS, OPERATIONS } from "./operations.ts";
import { getCategoryPaths } from "../sitemap.ts";

const registry = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
const active = registry.filter((tool) => tool.isActive);
const activeIn = (operation) => active.filter((tool) => tool.operation === operation);
// Popular first, then new, then by name.
const inLinkHubOrder = (tools) =>
  [...tools].sort(
    (a, b) =>
      Number(Boolean(b.isPopular)) - Number(Boolean(a.isPopular)) ||
      Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)) ||
      a.name.localeCompare(b.name),
  );
// A link hub tab or homepage section without its Tools: its category.
const withoutTools = (entry) => {
  const category = { ...entry };
  delete category.tools;
  return category;
};
// Every page of a category, page 1 first.
const allPages = (operation) => {
  const pages = [];
  for (let page = 1; categoryPage(operation, page); page += 1) pages.push(categoryPage(operation, page));
  return pages;
};

// What a ToolCard gets for a Tool: these keys, in this order, and nothing else.
function expectedCard(tool) {
  const icon = toolIconName(tool.id);
  return {
    href: toolHref(tool),
    name: tool.name,
    description: tool.description,
    ...(icon === DEFAULT_TOOL_ICON ? {} : { icon }),
  };
}

// The search index is fetched by the homepage search, the cards are
// serialized into the homepage and each category page, and the link hub into
// nearly every page. These tests pin their exact shapes, so a new field has to
// be added here on purpose.
test("each search index entry is a card plus its category and leftover search terms, nothing else", () => {
  const grid = toolSearchIndex();

  assert.equal(grid.length, active.length);
  grid.forEach((entry, index) => {
    const tool = active[index];
    const { terms, ...rest } = entry;
    assert.deepEqual(rest, { ...expectedCard(tool), category: tool.operation }, tool.id);
    assert.deepEqual(
      Object.keys(entry),
      [...Object.keys(expectedCard(tool)), "category", ...(terms ? ["terms"] : [])],
      tool.id,
    );
    if (terms) assert.ok(terms.length > 0, `${tool.id}: an empty terms list is left out`);
  });
  assert.equal(toolSearchIndex(), toolSearchIndex());
});

test("the search index finds a Tool by exactly the words the full tags and keywords did", () => {
  for (const [index, entry] of toolSearchIndex().entries()) {
    const tool = active[index];
    const name = tool.name.toLowerCase();
    const description = tool.description.toLowerCase();
    const words = [tool.from, tool.to, ...(tool.tags ?? []), ...(tool.keywords ?? [])]
      .filter(Boolean)
      .map((word) => word.toLowerCase());
    const terms = entry.terms ?? [];

    // Nothing new to match on...
    for (const term of terms) assert.ok(words.includes(term), `${tool.id}: ${term}`);
    // ...and every word still matches, through a term or the text itself.
    for (const word of words) {
      assert.ok(
        terms.includes(word) || name.includes(word) || description.includes(word),
        `${tool.id}: ${word}`,
      );
    }
  }
});

test("a card links the Tool's public path and names its icon only when it isn't the default", () => {
  const pngToPng = active.find((tool) => tool.id === "png-to-png");
  assert.equal(
    categoryPage("compress", 1).tools.find((card) => card.name === pngToPng.name)?.href,
    "/compress-png/",
  );
  assert.equal(toolSearchIndex().find((entry) => entry.href === "/video-downloader/")?.icon, "video");
  assert.equal(toolSearchIndex().find((entry) => entry.href === "/png-to-jpg/")?.icon, undefined);
  for (const entry of toolSearchIndex()) {
    if (entry.icon) assert.ok(TOOL_ICON_NAMES.includes(entry.icon), entry.icon);
  }
});

test("a category's pages split its active Tools in registry order, card fields only, each Tool once", () => {
  for (const operation of OPERATIONS) {
    const tools = activeIn(operation);
    const pages = allPages(operation);
    if (tools.length === 0) {
      assert.deepEqual(pages, [], operation);
      continue;
    }

    assert.equal(pages.length, Math.ceil(tools.length / CATEGORY_PAGE_SIZE), operation);
    assert.deepEqual(pages.flatMap((page) => page.tools), tools.map(expectedCard), operation);
    pages.forEach((page, index) => {
      assert.equal(page.page, index + 1);
      assert.equal(page.pageCount, pages.length);
      assert.ok(page.tools.length >= 1 && page.tools.length <= CATEGORY_PAGE_SIZE, `${operation} ${page.page}`);
      assert.equal(page.first, index * CATEGORY_PAGE_SIZE + 1);
      assert.equal(page.last, page.first + page.tools.length - 1);
      assert.equal(page.category, directoryCategories().find((category) => category.id === operation));
    });
  }
  assert.ok(allPages("convert").length > 1, "convert needs more than one page");
});

test("a page outside a category's range, or of an unknown category, doesn't exist", () => {
  const pageCount = allPages("convert").length;
  for (const page of [0, -1, 1.5, Number.NaN, pageCount + 1]) {
    assert.equal(categoryPage("convert", page), undefined, String(page));
  }
  assert.equal(categoryPage("not-a-category", 1), undefined);
  assert.equal(categoryPage("constructor", 1), undefined);
});

test("category page URLs: page 1 is the category, then /{n}/; only canonical numbers parse", () => {
  assert.equal(categoryPageHref("convert", 1), "/category/convert/");
  assert.equal(categoryPageHref("convert", 2), "/category/convert/2/");
  assert.deepEqual(categoryPageHrefs("bulk", 1), ["/category/bulk/"]);
  assert.deepEqual(categoryPageHrefs("download", CATEGORY_PAGE_SIZE + 1), [
    "/category/download/",
    "/category/download/2/",
  ]);
  assert.equal(categoryPageCount(0), 1);
  assert.equal(categoryPageCount(CATEGORY_PAGE_SIZE), 1);
  assert.equal(categoryPageCount(CATEGORY_PAGE_SIZE + 1), 2);
  assert.equal(parseCategoryPage("2"), 2);
  assert.equal(parseCategoryPage("19"), 19);
  for (const segment of ["0", "02", "2.0", "-1", "1e1", " 2", "two", ""]) {
    assert.equal(parseCategoryPage(segment), undefined, JSON.stringify(segment));
  }
});

test("the categories sitemap lists every page of every category, and nothing else", () => {
  const pageHrefs = directoryCategories().flatMap((category) =>
    allPages(category.id).map((page) => categoryPageHref(category.id, page.page)),
  );
  assert.deepEqual(getCategoryPaths(registry), pageHrefs);
});

test("every operation has category content", () => {
  assert.deepEqual(Object.keys(CATEGORY_CONTENT).sort(), [...OPERATIONS].sort());
});

test("each category with an active Tool is listed once, in OPERATIONS order, with its count", () => {
  const categories = directoryCategories();

  assert.deepEqual(
    categories.map((category) => category.href),
    [
      "/category/convert/",
      "/category/download/",
      "/category/compress/",
      "/category/combine/",
      "/category/bulk/",
      "/category/edit/",
      "/category/video-editor/",
      "/category/image-editor/",
      "/category/audio-editor/",
      "/category/view/",
    ],
  );
  for (const category of categories) {
    assert.deepEqual(category, {
      id: category.id,
      name: OPERATION_LABELS[category.id],
      title: CATEGORY_CONTENT[category.id].title,
      description: CATEGORY_CONTENT[category.id].description,
      count: activeIn(category.id).length,
      href: categoryHref(category.id),
    });
  }
  assert.equal(
    categories.reduce((sum, category) => sum + category.count, 0),
    active.length,
  );
  // The search index and the categories leave out the same Tools, so
  // "Filter (n)" on the homepage is the sum of the category counts.
  assert.equal(
    toolSearchIndex().length,
    categories.reduce((sum, category) => sum + category.count, 0),
  );
  assert.equal(directoryCategories(), directoryCategories());
});

test("the download category holds every active download Tool, including each download-*-videos Lander", () => {
  const downloadHrefs = allPages("download").flatMap((page) => page.tools.map((card) => card.href));

  assert.deepEqual(downloadHrefs, activeIn("download").map(toolHref));
  assert.deepEqual(
    active
      .filter((tool) => /^download-.+-videos$/.test(tool.id))
      .map(toolHref)
      .filter((href) => !downloadHrefs.includes(href)),
    [],
    "expected every download-*-videos lander to appear in /category/download/",
  );
});

test("each link hub tab is its category and its first Tools' href and name: popular, then new, then by name", () => {
  const tabs = toolLinkCategories();

  assert.deepEqual(tabs.map(withoutTools), directoryCategories());
  for (const tab of tabs) {
    assert.deepEqual(Object.keys(tab), ["id", "name", "title", "description", "count", "href", "tools"]);
  }
  for (const tab of tabs) {
    const expected = inLinkHubOrder(activeIn(tab.id))
      .slice(0, LINK_HUB_TAB_LIMIT)
      .map((tool) => ({ href: toolHref(tool), name: tool.name }));
    assert.deepEqual(tab.tools, expected, tab.id);
    for (const link of tab.tools) assert.deepEqual(Object.keys(link), ["href", "name"]);
  }
  assert.equal(tabs.find((tab) => tab.id === "convert").tools.length, LINK_HUB_TAB_LIMIT);
  assert.equal(toolLinkCategories(), toolLinkCategories());
});

test("each homepage section is its category and its first Tools' cards in link hub order", () => {
  const sections = homeCategorySections();

  assert.deepEqual(sections.map(withoutTools), directoryCategories());
  for (const section of sections) {
    assert.deepEqual(
      section.tools,
      inLinkHubOrder(activeIn(section.id)).slice(0, HOME_TOOLS_PER_CATEGORY).map(expectedCard),
      section.id,
    );
  }
  assert.equal(homeCategorySections(), homeCategorySections());
});

test("directory lists survive the Server-to-client props boundary unchanged", () => {
  for (const list of [
    toolSearchIndex(),
    directoryCategories(),
    toolLinkCategories(),
    homeCategorySections(),
    categoryPage("convert", 1),
  ]) {
    assert.deepEqual(JSON.parse(JSON.stringify(list)), list);
  }
});

// Byte budgets for the lists sent as JSON. Inline: the link hub with nearly
// every page, the homepage sections with the homepage, and the cards of the
// largest category page. Fetched: the search index, when someone searches on
// the homepage. Each sits about 10% above its size when it was set (#317,
// 2,529 active Tools: link hub 9,654 B, homepage sections 7,101 B, largest
// category page 24,381 B, search index 384,573 B). The inline lists are
// bounded by LINK_HUB_TAB_LIMIT, HOME_TOOLS_PER_CATEGORY and
// CATEGORY_PAGE_SIZE, so they grow with a new field, not with new Tools; the
// search index grows with every Tool, room for about 250 more. To raise one on
// purpose, measure the list's UTF-8 JSON bytes, set the budget about 10% above
// that, and say why in the PR.
const LINK_HUB_BUDGET_BYTES = 10_600;
const HOME_SECTIONS_BUDGET_BYTES = 7_800;
const CATEGORY_PAGE_BUDGET_BYTES = 26_800;
const SEARCH_INDEX_BUDGET_BYTES = 423_000;

test("the link hub, homepage sections, category pages and search index stay within their byte budgets", () => {
  const bytes = (list) => Buffer.byteLength(JSON.stringify(list));
  const budgets = [
    ["link hub", bytes(toolLinkCategories()), LINK_HUB_BUDGET_BYTES],
    ["homepage sections", bytes(homeCategorySections()), HOME_SECTIONS_BUDGET_BYTES],
    [
      "largest category page",
      Math.max(
        ...directoryCategories().flatMap((category) =>
          allPages(category.id).map((page) => bytes(page.tools)),
        ),
      ),
      CATEGORY_PAGE_BUDGET_BYTES,
    ],
    ["search index", bytes(toolSearchIndex()), SEARCH_INDEX_BUDGET_BYTES],
  ];
  for (const [name, size, budget] of budgets) {
    assert.ok(size <= budget, `${name} is ${size} B, budget ${budget} B`);
  }
});

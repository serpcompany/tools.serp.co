import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import {
  directoryCategories,
  directoryGrid,
  toolCardsIn,
  toolLinkCategories,
} from "./directory.ts";
import { categoryHref, toolHref } from "./href.ts";
import { DEFAULT_TOOL_ICON, TOOL_ICON_NAMES, toolIconName } from "./icons.ts";
import { CATEGORY_CONTENT, OPERATION_LABELS, OPERATIONS } from "./operations.ts";

const registry = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
const active = registry.filter((tool) => tool.isActive);
const activeIn = (operation) => active.filter((tool) => tool.operation === operation);

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

// The grid entries are serialized into the homepage, the cards into each
// category page and the link hub into nearly every page. These tests pin
// their exact shapes, so a new field has to be added here on purpose.
test("each homepage grid entry is a card plus its category and leftover search terms, nothing else", () => {
  const grid = directoryGrid();

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
  assert.equal(directoryGrid(), directoryGrid());
});

test("the grid's search finds a Tool by exactly the words the full tags and keywords did", () => {
  for (const [index, entry] of directoryGrid().entries()) {
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
  assert.equal(toolCardsIn("compress").find((card) => card.name === pngToPng.name)?.href, "/compress-png/");
  assert.equal(directoryGrid().find((entry) => entry.href === "/video-downloader/")?.icon, "video");
  assert.equal(directoryGrid().find((entry) => entry.href === "/png-to-jpg/")?.icon, undefined);
  for (const entry of directoryGrid()) {
    if (entry.icon) assert.ok(TOOL_ICON_NAMES.includes(entry.icon), entry.icon);
  }
});

test("a category page's cards are its active Tools in registry order, card fields only", () => {
  for (const operation of OPERATIONS) {
    assert.deepEqual(toolCardsIn(operation), activeIn(operation).map(expectedCard), operation);
  }
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
  // The grid and the categories leave out the same Tools, so "Filter (n)" on
  // the homepage is the sum of the category counts.
  assert.equal(
    directoryGrid().length,
    categories.reduce((sum, category) => sum + category.count, 0),
  );
  assert.equal(directoryCategories(), directoryCategories());
});

test("the download category holds every active download Tool, including each download-*-videos Lander", () => {
  const downloadHrefs = toolCardsIn("download").map((card) => card.href);

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

test("each link hub tab is its category without the count, and an href and name per Tool: popular, then new, then by name", () => {
  const tabs = toolLinkCategories();

  assert.deepEqual(
    tabs.map(({ tools, ...category }) => {
      assert.deepEqual(Object.keys(category), ["id", "name", "title", "description", "href"]);
      return { ...category, tools: tools.length };
    }),
    directoryCategories().map(({ count, ...category }) => ({ ...category, tools: count })),
  );
  for (const tab of tabs) {
    const expected = activeIn(tab.id)
      .sort(
        (a, b) =>
          Number(Boolean(b.isPopular)) - Number(Boolean(a.isPopular)) ||
          Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)) ||
          a.name.localeCompare(b.name),
      )
      .map((tool) => ({ href: toolHref(tool), name: tool.name }));
    assert.deepEqual(tab.tools, expected, tab.id);
    for (const link of tab.tools) assert.deepEqual(Object.keys(link), ["href", "name"]);
  }
  assert.equal(toolLinkCategories(), toolLinkCategories());
});

test("directory lists survive the Server-to-client props boundary unchanged", () => {
  for (const list of [directoryGrid(), directoryCategories(), toolLinkCategories(), toolCardsIn("convert")]) {
    assert.deepEqual(JSON.parse(JSON.stringify(list)), list);
  }
});

// Byte budgets for the two lists sent inline as JSON: the link hub with nearly
// every page, the grid with the homepage. Each sits about 10% above its size
// when it was set (link hub 130,654 B, grid 396,800 B, 2,643 active Tools):
// room for about 260 more Tools, which a field added to every entry would use
// up quickly. To raise one on purpose, measure the list's UTF-8 JSON bytes,
// set the budget about 10% above that, and say why in the PR: these bytes
// ship with every page that renders the list.
const LINK_HUB_BUDGET_BYTES = 144_000;
const HOMEPAGE_GRID_BUDGET_BYTES = 437_000;

test("the link hub and the homepage grid stay within their byte budgets", () => {
  const hubBytes = Buffer.byteLength(JSON.stringify(toolLinkCategories()));
  const gridBytes = Buffer.byteLength(JSON.stringify(directoryGrid()));
  assert.ok(hubBytes <= LINK_HUB_BUDGET_BYTES, `link hub is ${hubBytes} B, budget ${LINK_HUB_BUDGET_BYTES} B`);
  assert.ok(
    gridBytes <= HOMEPAGE_GRID_BUDGET_BYTES,
    `homepage grid is ${gridBytes} B, budget ${HOMEPAGE_GRID_BUDGET_BYTES} B`,
  );
});

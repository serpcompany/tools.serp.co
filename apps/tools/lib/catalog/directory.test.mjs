import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  directoryCategories,
  directoryEntries,
  directoryEntriesIn,
  toolLinkCategories,
} from "./directory.ts";
import { categoryHref } from "./href.ts";
import { CATEGORY_CONTENT, OPERATION_LABELS, OPERATIONS } from "./operations.ts";

const registry = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
const active = registry.filter((tool) => tool.isActive);

test("the directory lists every active Tool once, in registry order, built once", () => {
  assert.deepEqual(
    directoryEntries().map((entry) => entry.id),
    active.map((tool) => tool.id),
  );
  assert.equal(directoryEntries(), directoryEntries());
});

test("a directory entry links the Tool's public path and searches its formats, tags and keywords", () => {
  const byId = new Map(directoryEntries().map((entry) => [entry.id, entry]));
  const csvToMarkdown = active.find((tool) => tool.id === "csv-to-markdown");

  assert.deepEqual(byId.get("csv-to-markdown"), {
    id: "csv-to-markdown",
    name: csvToMarkdown.name,
    description: csvToMarkdown.description,
    category: "convert",
    href: "/csv-to-markdown/",
    tags: ["csv", "markdown"],
    isNew: false,
    isPopular: false,
  });
  // png-to-png is served at /compress-png/.
  assert.equal(byId.get("png-to-png")?.href, "/compress-png/");

  for (const tool of active) {
    const expected = new Set(
      [tool.from, tool.to, ...(tool.tags ?? []), ...(tool.keywords ?? [])].filter(Boolean),
    );
    assert.deepEqual(byId.get(tool.id)?.tags, [...expected], tool.id);
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
      count: active.filter((tool) => tool.operation === category.id).length,
      href: categoryHref(category.id),
    });
  }
  assert.equal(
    categories.reduce((sum, category) => sum + category.count, 0),
    active.length,
  );
  assert.equal(directoryCategories(), directoryCategories());
});

test("the download category holds every active download Tool, including each download-*-videos Lander", () => {
  const downloadIds = directoryEntriesIn("download").map((entry) => entry.id);

  assert.deepEqual(
    [...downloadIds].sort(),
    active.filter((tool) => tool.operation === "download").map((tool) => tool.id).sort(),
  );
  assert.deepEqual(
    active
      .filter((tool) => /^download-.+-videos$/.test(tool.id))
      .map((tool) => tool.id)
      .filter((id) => !downloadIds.includes(id)),
    [],
    "expected every download-*-videos lander to appear in /category/download/",
  );
});

test("each link hub tab links every Tool in its category: popular, then new, then by name", () => {
  const tabs = toolLinkCategories();

  assert.deepEqual(
    tabs.map(({ id, name, title, description, href }) => ({ id, name, title, description, href })),
    directoryCategories().map(({ id, name, title, description, href }) => ({
      id,
      name,
      title,
      description,
      href,
    })),
  );
  for (const tab of tabs) {
    const expected = directoryEntriesIn(tab.id)
      .sort(
        (a, b) =>
          Number(b.isPopular) - Number(a.isPopular) ||
          Number(b.isNew) - Number(a.isNew) ||
          a.name.localeCompare(b.name),
      )
      .map((entry) => ({ href: entry.href, title: entry.name }));
    assert.deepEqual(tab.tools, expected, tab.id);
  }
  assert.equal(toolLinkCategories(), toolLinkCategories());
});

test("directory lists survive the Server-to-client props boundary unchanged", () => {
  for (const list of [directoryEntries(), directoryCategories(), toolLinkCategories()]) {
    assert.deepEqual(JSON.parse(JSON.stringify(list)), list);
  }
});

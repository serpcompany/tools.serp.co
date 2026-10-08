import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TABLE_CONVERT_PAGES } from "./table-convert-pages.ts";
import { directoryEntries } from "./catalog/directory.ts";

const toolsRegistry = JSON.parse(
  readFileSync(new URL("./catalog/tools.json", import.meta.url), "utf8"),
);
const csvToMarkdownPageSource = readFileSync(
  new URL("../app/(convert)/csv-to-markdown/page.tsx", import.meta.url),
  "utf8",
);

function normalizeRoute(route) {
  if (!route) {
    return null;
  }

  const normalized = String(route).replace(/\/$/, "");
  return normalized === "" ? "/" : `${normalized}/`;
}

test("csv-to-markdown is discoverable through page, directory, and sitemap data", () => {
  const tableConvertEntry = TABLE_CONVERT_PAGES.find((entry) => entry.slug === "csv-to-markdown");
  const tool = toolsRegistry.find((entry) => entry.id === "csv-to-markdown");
  const directoryEntry = directoryEntries().find((entry) => entry.id === "csv-to-markdown");
  const sitemapRoutes = new Set(
    toolsRegistry
      .filter((entry) => entry.isActive)
      .map((entry) => normalizeRoute(entry.route))
      .filter(Boolean),
  );

  assert.match(csvToMarkdownPageSource, /const slug = "csv-to-markdown"/);
  assert.match(csvToMarkdownPageSource, /const fromFormat = "csv"/);
  assert.match(csvToMarkdownPageSource, /const toFormat = "markdown"/);

  assert.deepEqual(tableConvertEntry, {
    slug: "csv-to-markdown",
    from: "csv",
    to: "markdown",
    title: "Convert CSV to Markdown Table Online",
  });

  assert.ok(tool, "expected csv-to-markdown in tools.json");
  assert.equal(tool.operation, "convert");
  assert.equal(tool.route, "/csv-to-markdown");
  assert.equal(tool.from, "csv");
  assert.equal(tool.to, "markdown");
  assert.equal(tool.isActive, true);

  assert.ok(directoryEntry, "expected csv-to-markdown in homepage directory entries");
  assert.deepEqual(directoryEntry?.tags, ["csv", "markdown"]);
  assert.equal(directoryEntry?.href, "/csv-to-markdown/");

  assert.ok(sitemapRoutes.has("/csv-to-markdown/"), "expected csv-to-markdown in sitemap routes");
});

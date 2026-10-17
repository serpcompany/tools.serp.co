import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toolsLinkHubSource = readFileSync(
  new URL("../components/sections/ToolsLinkHub.tsx", import.meta.url),
  "utf8",
);
const toolsLinkHubTabsSource = readFileSync(
  new URL("../components/sections/ToolsLinkHubTabs.tsx", import.meta.url),
  "utf8",
);

test("tools link hub reads the catalog on the server and passes the tabs plain data", () => {
  assert.doesNotMatch(toolsLinkHubSource, /use client/);
  assert.match(toolsLinkHubSource, /toolLinkCategories\(\)/);
  assert.match(toolsLinkHubSource, /<ToolsLinkHubTabs categories=/);
  assert.match(toolsLinkHubTabsSource, /^"use client";/);
});

test("tools link hub tabs show only the links they were sent, and link the category for the rest", () => {
  assert.match(toolsLinkHubTabsSource, /TabsList/);
  assert.match(toolsLinkHubTabsSource, /TabsTrigger/);
  // No "show more": the tab never holds more than it shows.
  assert.doesNotMatch(toolsLinkHubTabsSource, /showAllTools|CATEGORY_PREVIEW_LIMIT|\.slice\(/);
  assert.match(toolsLinkHubTabsSource, /activeCategory\.tools\.map\(/);
  assert.match(toolsLinkHubTabsSource, /hiddenToolCount/);
  assert.match(toolsLinkHubTabsSource, /See all \{activeCategory\.count\} tools in \{activeCategory\.name\}/);
  assert.match(toolsLinkHubTabsSource, /View \{activeCategory\.name\} category/);
});

// The hub is on every page: a default <Link> to a category page would prefetch
// up to 120 cards on each visit.
test("tools link hub links don't prefetch", () => {
  const links = toolsLinkHubTabsSource.match(/<Link\b[^>]*>/g) ?? [];
  assert.ok(links.length >= 3);
  for (const link of links) assert.match(link, /prefetch=\{false\}/, link);
});

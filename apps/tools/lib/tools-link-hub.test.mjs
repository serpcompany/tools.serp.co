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

test("tools link hub uses tabbed progressive disclosure for large tool sets", () => {
  assert.match(toolsLinkHubTabsSource, /TabsList/);
  assert.match(toolsLinkHubTabsSource, /TabsTrigger/);
  assert.match(toolsLinkHubTabsSource, /CATEGORY_PREVIEW_LIMIT\s*=\s*48/);
  assert.match(toolsLinkHubTabsSource, /showAllTools/);
  assert.match(toolsLinkHubTabsSource, /Show fewer tools/);
  assert.match(toolsLinkHubTabsSource, /hiddenToolCount/);
  assert.match(toolsLinkHubTabsSource, /setShowAllTools\(false\)/);
  assert.match(toolsLinkHubTabsSource, /View \{activeCategory\.name\} category/);
});

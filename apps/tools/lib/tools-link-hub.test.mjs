import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const toolsLinkHubSource = readFileSync(
  new URL('../components/sections/ToolsLinkHub.tsx', import.meta.url),
  'utf8',
);
const toolsLinkHubClientSource = readFileSync(
  new URL('../components/sections/ToolsLinkHubClient.tsx', import.meta.url),
  'utf8',
);
const toolLinkCategoriesSource = readFileSync(
  new URL('./tool-link-categories.ts', import.meta.url),
  'utf8',
);

test('tools link hub uses tabbed progressive disclosure for large tool sets', () => {
  assert.match(toolsLinkHubSource, /getToolLinkCategories/);
  assert.match(toolsLinkHubSource, /ToolsLinkHubClient/);
  assert.doesNotMatch(toolsLinkHubSource, /use client/);
  assert.doesNotMatch(toolsLinkHubSource, /data\/tools\.json/);
  assert.doesNotMatch(toolsLinkHubSource, /tool-directory/);
  assert.match(toolLinkCategoriesSource, /toolCatalog/);
  assert.match(toolLinkCategoriesSource, /directoryCategories/);
  assert.match(toolLinkCategoriesSource, /getDirectoryTools/);
  assert.doesNotMatch(toolLinkCategoriesSource, /data\/tools\.json/);
  assert.doesNotMatch(toolLinkCategoriesSource, /tool-directory/);
  assert.match(toolsLinkHubClientSource, /use client/);
  assert.doesNotMatch(toolsLinkHubClientSource, /toolCatalog/);
  assert.doesNotMatch(toolsLinkHubClientSource, /data\/tools\.json/);
  assert.match(toolsLinkHubClientSource, /TabsList/);
  assert.match(toolsLinkHubClientSource, /TabsTrigger/);
  assert.match(toolsLinkHubClientSource, /CATEGORY_PREVIEW_LIMIT\s*=\s*48/);
  assert.match(toolsLinkHubClientSource, /showAllTools/);
  assert.match(toolsLinkHubClientSource, /Show fewer tools/);
  assert.match(toolsLinkHubClientSource, /hiddenToolCount/);
  assert.match(toolsLinkHubClientSource, /setShowAllTools\(false\)/);
  assert.match(
    toolsLinkHubClientSource,
    /View \{activeCategory\.name\} category/,
  );
});

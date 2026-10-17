import type { Tool } from "@/types";

import { activeTools } from "./catalog.ts";
import { CATEGORY_PAGE_SIZE, categoryPageCount } from "./category-pages.ts";
import { categoryHref, toolHref } from "./href.ts";
import { DEFAULT_TOOL_ICON, toolIconName, type ToolIconName } from "./icons.ts";
import {
  CATEGORY_CONTENT,
  OPERATION_LABELS,
  OPERATIONS,
  isToolOperation,
  type ToolOperation,
} from "./operations.ts";

// The tool directory: what the homepage, its search, /categories/, the
// category pages and the link hub list. It reads the registry, so only Server
// Components and route handlers import it. The lists they pass to client
// components are serialized into every page that renders them, so each list is
// bounded and each entry carries only what the client renders or filters on
// (directory.test.mjs pins the shapes and their sizes). Only the search index
// lists every Tool, and it is fetched when someone searches, not inlined.
// toolSearchIndex, directoryCategories, toolLinkCategories and
// homeCategorySections are built on first use and shared by every caller,
// which must not mutate them; categoryPage builds a new page on each call. A
// Tool whose operation isn't one of OPERATIONS (validate.ts rejects it) is left
// out of every list, so the lists and the category counts always agree.

// How many links each link hub tab sends and shows; the rest are on the
// category's pages.
export const LINK_HUB_TAB_LIMIT = 48;

// How many Tool cards the homepage shows per category before "View all".
export const HOME_TOOLS_PER_CATEGORY = 8;

// A ToolCard: the Tool's name and description, linked. `icon` is left out
// when it's the default.
export type ToolCardEntry = {
  href: string;
  name: string;
  description: string;
  icon?: ToolIconName;
};

// A homepage search entry. The search matches the name, the description and
// `terms`: the Tool's formats, tags and keywords, lowercased, minus any the
// name or description already contains, since those can't add a match.
// `terms` is left out when empty.
export type ToolSearchEntry = ToolCardEntry & {
  category: ToolOperation;
  terms?: string[];
};

export type ToolDirectoryCategory = {
  id: ToolOperation;
  name: string;
  title: string;
  description: string;
  count: number;
  href: string;
};

// A link hub tab: one category, its Tool count, and a link to each of its
// first LINK_HUB_TAB_LIMIT Tools in link hub order.
export type ToolLinkCategory = ToolDirectoryCategory & {
  tools: { href: string; name: string }[];
};

// A homepage section: one category and the cards of its first
// HOME_TOOLS_PER_CATEGORY Tools in link hub order.
export type HomeCategorySection = ToolDirectoryCategory & {
  tools: ToolCardEntry[];
};

// One numbered page of a category: its cards in registry order, and where they
// sit in the whole list (`first` and `last` count from 1).
export type CategoryPage = {
  category: ToolDirectoryCategory;
  page: number;
  pageCount: number;
  first: number;
  last: number;
  tools: ToolCardEntry[];
};

let byOperation: Map<ToolOperation, Tool[]> | undefined;
let byLinkHubOrder: Map<ToolOperation, Tool[]> | undefined;
let searchIndex: readonly ToolSearchEntry[] | undefined;
let categories: readonly ToolDirectoryCategory[] | undefined;
let linkCategories: readonly ToolLinkCategory[] | undefined;
let homeSections: readonly HomeCategorySection[] | undefined;

// The active Tools in one operation, in registry order.
function activeIn(operation: ToolOperation): readonly Tool[] {
  if (!byOperation) {
    byOperation = new Map(OPERATIONS.map((op) => [op, []]));
    for (const tool of activeTools()) byOperation.get(tool.operation)?.push(tool);
  }
  return byOperation.get(operation) ?? [];
}

// Popular first, then new, then by name.
function linkHubOrder(a: Tool, b: Tool): number {
  const rank = (tool: Tool) => (tool.isPopular ? 2 : 0) + (tool.isNew ? 1 : 0);
  return rank(b) - rank(a) || a.name.localeCompare(b.name);
}

// The active Tools in one operation, in link hub order.
function activeInLinkHubOrder(operation: ToolOperation): readonly Tool[] {
  byLinkHubOrder ??= new Map(
    OPERATIONS.map((op) => [op, [...activeIn(op)].sort(linkHubOrder)]),
  );
  return byLinkHubOrder.get(operation) ?? [];
}

function toolCard(tool: Tool): ToolCardEntry {
  const card: ToolCardEntry = {
    href: toolHref(tool),
    name: tool.name,
    description: tool.description,
  };
  const icon = toolIconName(tool.id);
  if (icon !== DEFAULT_TOOL_ICON) card.icon = icon;
  return card;
}

function searchTerms(tool: Tool): string[] {
  const name = tool.name.toLowerCase();
  const description = tool.description.toLowerCase();
  const values = [tool.from, tool.to, ...(tool.tags ?? []), ...(tool.keywords ?? [])];
  const terms = new Set(
    values.filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()),
  );
  return [...terms].filter((term) => !name.includes(term) && !description.includes(term));
}

// The homepage search index: every active Tool, in registry order. Served as
// /tool-index.json, which the homepage fetches when someone searches.
export function toolSearchIndex(): readonly ToolSearchEntry[] {
  searchIndex ??= activeTools()
    .filter((tool) => isToolOperation(tool.operation))
    .map((tool) => {
      const entry: ToolSearchEntry = { ...toolCard(tool), category: tool.operation };
      const terms = searchTerms(tool);
      if (terms.length > 0) entry.terms = terms;
      return entry;
    });
  return searchIndex;
}

// The categories that hold at least one active Tool, in OPERATIONS order.
export function directoryCategories(): readonly ToolDirectoryCategory[] {
  categories ??= OPERATIONS.flatMap((operation) => {
    const count = activeIn(operation).length;
    if (count === 0) return [];
    return [
      {
        id: operation,
        name: OPERATION_LABELS[operation],
        title: CATEGORY_CONTENT[operation].title,
        description: CATEGORY_CONTENT[operation].description,
        count,
        href: categoryHref(operation),
      },
    ];
  });
  return categories;
}

// Page `page` of a category's cards, CATEGORY_PAGE_SIZE to a page in registry
// order, or undefined when the category has no active Tool or no such page.
export function categoryPage(operation: string, page: number): CategoryPage | undefined {
  const category = directoryCategories().find((candidate) => candidate.id === operation);
  if (!category || !Number.isInteger(page)) return undefined;
  const pageCount = categoryPageCount(category.count);
  if (page < 1 || page > pageCount) return undefined;

  const start = (page - 1) * CATEGORY_PAGE_SIZE;
  const tools = activeIn(category.id).slice(start, start + CATEGORY_PAGE_SIZE).map(toolCard);
  return { category, page, pageCount, first: start + 1, last: start + tools.length, tools };
}

// The link hub's tabs: each category with the links its tab shows.
export function toolLinkCategories(): readonly ToolLinkCategory[] {
  linkCategories ??= directoryCategories().map((category) => ({
    ...category,
    tools: activeInLinkHubOrder(category.id)
      .slice(0, LINK_HUB_TAB_LIMIT)
      .map((tool) => ({ href: toolHref(tool), name: tool.name })),
  }));
  return linkCategories;
}

// The homepage's sections: each category with the cards it shows.
export function homeCategorySections(): readonly HomeCategorySection[] {
  homeSections ??= directoryCategories().map((category) => ({
    ...category,
    tools: activeInLinkHubOrder(category.id).slice(0, HOME_TOOLS_PER_CATEGORY).map(toolCard),
  }));
  return homeSections;
}

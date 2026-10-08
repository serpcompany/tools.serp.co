import type { Tool } from "@/types";

import { activeTools } from "./catalog.ts";
import { categoryHref, toolHref } from "./href.ts";
import { DEFAULT_TOOL_ICON, toolIconName, type ToolIconName } from "./icons.ts";
import {
  CATEGORY_CONTENT,
  OPERATION_LABELS,
  OPERATIONS,
  type ToolOperation,
} from "./operations.ts";

// The tool directory: what the homepage grid, /categories/, the category pages
// and the link hub list. It reads the registry, so only Server Components
// import it. The lists they pass to client components are serialized into
// every page that renders them, so each entry carries only what the client
// renders or filters on (directory.test.mjs pins the shapes). Lists are built
// on first use and shared by every caller, which must not mutate them.

// A ToolCard: the Tool's name and description, linked. `icon` is left out
// when it's the default.
export type ToolCardEntry = {
  href: string;
  name: string;
  description: string;
  icon?: ToolIconName;
};

// A homepage grid entry. The search matches the name, the description and
// `terms`: the Tool's formats, tags and keywords, lowercased, minus any the
// name or description already contains, since those can't add a match.
// `terms` is left out when empty.
export type DirectoryGridEntry = ToolCardEntry & {
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

// A link hub tab: one category and a link to each of its Tools, in display
// order.
export type ToolLinkCategory = Omit<ToolDirectoryCategory, "count"> & {
  tools: { href: string; name: string }[];
};

let byOperation: Map<ToolOperation, Tool[]> | undefined;
let grid: readonly DirectoryGridEntry[] | undefined;
let categories: readonly ToolDirectoryCategory[] | undefined;
let linkCategories: readonly ToolLinkCategory[] | undefined;

// The active Tools in one operation, in registry order.
function activeIn(operation: ToolOperation): readonly Tool[] {
  if (!byOperation) {
    byOperation = new Map(OPERATIONS.map((op) => [op, []]));
    for (const tool of activeTools()) byOperation.get(tool.operation)?.push(tool);
  }
  return byOperation.get(operation) ?? [];
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

// The homepage grid: every active Tool, in registry order.
export function directoryGrid(): readonly DirectoryGridEntry[] {
  grid ??= activeTools().map((tool) => {
    const entry: DirectoryGridEntry = { ...toolCard(tool), category: tool.operation };
    const terms = searchTerms(tool);
    if (terms.length > 0) entry.terms = terms;
    return entry;
  });
  return grid;
}

// A category page's cards: the active Tools in one operation, in registry
// order.
export function toolCardsIn(operation: ToolOperation): ToolCardEntry[] {
  return activeIn(operation).map(toolCard);
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

// Popular first, then new, then by name.
function byLinkHubOrder(a: Tool, b: Tool): number {
  const rank = (tool: Tool) => (tool.isPopular ? 2 : 0) + (tool.isNew ? 1 : 0);
  return rank(b) - rank(a) || a.name.localeCompare(b.name);
}

// The link hub's tabs, each with its Tools already sorted.
export function toolLinkCategories(): readonly ToolLinkCategory[] {
  linkCategories ??= directoryCategories().map((category) => ({
    id: category.id,
    name: category.name,
    title: category.title,
    description: category.description,
    href: category.href,
    tools: [...activeIn(category.id)]
      .sort(byLinkHubOrder)
      .map((tool) => ({ href: toolHref(tool), name: tool.name })),
  }));
  return linkCategories;
}

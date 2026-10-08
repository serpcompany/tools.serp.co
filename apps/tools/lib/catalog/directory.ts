import type { Tool } from "@/types";

import { activeTools } from "./catalog.ts";
import { categoryHref, toolHref } from "./href.ts";
import {
  CATEGORY_CONTENT,
  OPERATION_LABELS,
  OPERATIONS,
  type ToolOperation,
} from "./operations.ts";

// The tool directory: what the homepage grid, /categories/, the category pages
// and the link hub list. It reads the registry, so only Server Components
// import it; a client component gets these plain-data lists as props and
// imports only their types. Each list is built on first use and shared by
// every caller, which must not mutate it.

export type ToolDirectoryEntry = {
  id: string;
  name: string;
  description: string;
  category: ToolOperation;
  href: string;
  tags: string[];
  isNew: boolean;
  isPopular: boolean;
};

export type ToolDirectoryCategory = {
  id: ToolOperation;
  name: string;
  title: string;
  description: string;
  count: number;
  href: string;
};

// A link hub tab: one category with every Tool in it, in display order.
export type ToolLinkCategory = Omit<ToolDirectoryCategory, "count"> & {
  tools: { href: string; title: string }[];
};

let entries: readonly ToolDirectoryEntry[] | undefined;
let categories: readonly ToolDirectoryCategory[] | undefined;
let linkCategories: readonly ToolLinkCategory[] | undefined;

// The words the homepage search matches besides name and description.
function searchTags(tool: Tool): string[] {
  const values = [tool.from, tool.to, ...(tool.tags ?? []), ...(tool.keywords ?? [])];
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

// Every active Tool, in registry order.
export function directoryEntries(): readonly ToolDirectoryEntry[] {
  entries ??= activeTools().map((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.operation,
    href: toolHref(tool),
    tags: searchTags(tool),
    isNew: Boolean(tool.isNew),
    isPopular: Boolean(tool.isPopular),
  }));
  return entries;
}

// The active Tools in one category, in registry order.
export function directoryEntriesIn(operation: ToolOperation): ToolDirectoryEntry[] {
  return directoryEntries().filter((entry) => entry.category === operation);
}

// The categories that hold at least one active Tool, in OPERATIONS order.
export function directoryCategories(): readonly ToolDirectoryCategory[] {
  categories ??= OPERATIONS.flatMap((operation) => {
    const count = directoryEntriesIn(operation).length;
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
function byLinkHubOrder(a: ToolDirectoryEntry, b: ToolDirectoryEntry): number {
  if (a.isPopular !== b.isPopular) return Number(b.isPopular) - Number(a.isPopular);
  if (a.isNew !== b.isNew) return Number(b.isNew) - Number(a.isNew);
  return a.name.localeCompare(b.name);
}

// The link hub's tabs, each with its Tools already sorted.
export function toolLinkCategories(): readonly ToolLinkCategory[] {
  linkCategories ??= directoryCategories().map((category) => ({
    id: category.id,
    name: category.name,
    title: category.title,
    description: category.description,
    href: category.href,
    tools: directoryEntriesIn(category.id)
      .sort(byLinkHubOrder)
      .map((entry) => ({ href: entry.href, title: entry.name })),
  }));
  return linkCategories;
}

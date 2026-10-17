import type { RelatedTool, Tool } from "@/types";

import { canonicalPath } from "../trailing-slash.ts";
import { activeTools, getTool, getToolByRoute } from "./catalog.ts";

// The links in a Tool page's Related Tools section (RelatedToolsSection). It
// reads the registry, so only Server Components import it.
//
// A curated `content.relatedTools` list renders as written, less the page's
// own Tool and any entry that isn't an active Tool. Without one, the section
// falls back to at most RELATED_TOOLS_LIMIT active Tools of the same kind that
// share a format with the page's Tool (issue #318): converters and compressors
// list converters and compressors, Landers list Landers.

export const RELATED_TOOLS_LIMIT = 24;

export type RelatedToolLink = {
  id: string;
  name: string;
  description: string;
  href: string;
};

// A curated entry; `description` replaces the linked Tool's own when set.
export type CuratedEntry = Omit<RelatedTool, "description"> & { description?: string };

type RelatedToolsQuery = {
  toolId?: string;
  route?: string;
  from?: string;
  to?: string;
  curated?: CuratedEntry[];
};

type Candidate = Pick<Tool, "id" | "route" | "operation" | "from" | "to" | "isActive">;

// Converters and compressors are one kind (a file in, a file out); every other
// operation, downloads included, is its own.
function kindOf(operation: string): string {
  return operation === "convert" || operation === "compress" ? "file" : operation;
}

// The fallback's order, most related first. A candidate takes the first tier it
// matches; one that shares no format with the page's Tool isn't listed.
const TIERS: ((tool: Candidate, from: string, to: string) => boolean)[] = [
  (tool, from, to) => tool.from === to && tool.to === from, // the reverse pair
  (tool, from) => tool.from === from, // same source format
  (tool, _from, to) => tool.to === to, // same target format
  (tool, _from, to) => tool.from === to, // onward from the target format
  (tool, from) => tool.to === from, // into the source format
];

// The fallback list for a Tool with no curated list: the active Tools of its
// kind that share a format with it, ordered by TIERS and then registry order,
// at most `limit` of them. The Tool itself is never listed.
export function fallbackRelatedTools<T extends Candidate>(
  current: Pick<Tool, "id" | "operation"> & { route?: string; from: string; to: string },
  candidates: readonly T[],
  limit = RELATED_TOOLS_LIMIT,
): T[] {
  const kind = kindOf(current.operation);
  const ranked: { tool: T; tier: number }[] = [];

  for (const tool of candidates) {
    if (!tool.isActive || tool.id === current.id || tool.route === current.route) continue;
    if (kindOf(tool.operation) !== kind) continue;
    const tier = TIERS.findIndex((matches) => matches(tool, current.from, current.to));
    if (tier !== -1) ranked.push({ tool, tier });
  }

  // Array.prototype.sort is stable, so registry order holds within a tier.
  return ranked
    .sort((a, b) => a.tier - b.tier)
    .slice(0, limit)
    .map(({ tool }) => tool);
}

// A curated entry as a link, or null when it names no active Tool. An entry
// with an off-site `href` is kept as written.
function resolveCurated(entry: CuratedEntry, index: number) {
  if (entry.toolId) {
    const resolved = getTool(entry.toolId);
    if (!resolved) return null;
    return {
      ...resolved,
      description: entry.description ?? resolved.description,
      name: entry.title || resolved.name,
    };
  }
  if (entry.href) {
    if (entry.href.startsWith("/")) {
      const resolved = getToolByRoute(entry.href);
      if (!resolved) return null;
      return {
        ...resolved,
        description: entry.description ?? resolved.description,
        name: entry.title || resolved.name,
      };
    }
    return {
      id: `related-${index}`,
      name: entry.title,
      description: entry.description ?? "",
      route: entry.href,
    };
  }
  return null;
}

// The Related Tools section's links for a Tool page, in display order.
export function relatedToolLinks({
  toolId,
  route,
  from,
  to,
  curated,
}: RelatedToolsQuery): RelatedToolLink[] {
  const isOtherTool = (tool: { id: string; route: string }) =>
    (toolId ? tool.id !== toolId : true) && (route ? tool.route !== route : true);

  const curatedTools = (curated ?? [])
    .map(resolveCurated)
    .filter((tool) => tool !== null)
    .filter(isOtherTool);

  let tools: { id: string; name: string; description: string; route: string }[] = curatedTools;
  if (tools.length === 0) {
    const current = toolId ? getTool(toolId) : route ? getToolByRoute(route) : undefined;
    tools =
      current && from && to
        ? fallbackRelatedTools({ id: current.id, operation: current.operation, route, from, to }, activeTools())
        : [];
  }

  // One link per Tool: a repeated entry keeps its first place and its last
  // title, as a Map does.
  const unique = Array.from(new Map(tools.map((tool) => [tool.id || tool.route, tool])).values());

  return unique.map((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    href: canonicalPath(tool.route),
  }));
}

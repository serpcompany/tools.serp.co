import type { RelatedTool, Tool } from "@/types";

import { canonicalPath } from "../trailing-slash.ts";
import { activeTools, getTool, getToolByRoute } from "./catalog.ts";

// The links in a Tool page's or Lander's Related Tools section
// (RelatedToolsSection). It reads the registry, so only Server Components
// import it.
//
// A curated `content.relatedTools` list renders as written, less the page's
// own Tool and any entry that isn't an active Tool. Without one, a converter
// or compressor page falls back to at most RELATED_TOOLS_LIMIT converters and
// compressors that share a format with its Tool (issue #318). The places are
// shared between groups and picked per page, so every converter and
// compressor page is on another page's list. A Lander lists
// LANDER_RELATED_LIMIT other Landers by a rotation, so every Lander is on
// exactly that many Landers' lists (issue #349). related-tools.test.mjs checks
// both on the catalog.

export const RELATED_TOOLS_LIMIT = 24;
export const LANDER_RELATED_LIMIT = 8;

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
  curated?: CuratedEntry[];
};

type Candidate = Pick<Tool, "id" | "route" | "operation" | "from" | "to" | "isActive">;

// Converters and compressors are one kind (a file in, a file out); every other
// operation, downloads included, is its own.
function kindOf(operation: string): string {
  return operation === "convert" || operation === "compress" ? "file" : operation;
}

// The fallback's groups, most related first; they show in this order. A
// candidate joins the first group it matches; one that shares no format with
// the page's Tool isn't listed.
//
// The places are shared out a turn at a time: the reverse pair takes what it
// has, then the same source and same target groups take one place each in
// alternation, and only then do the last two groups fill what is left the same
// way. A group with fewer Tools than its share leaves the rest to the others.
type Group = { turn: number; matches: (tool: Candidate, from: string, to: string) => boolean };
const GROUPS: Group[] = [
  { turn: 0, matches: (tool, from, to) => tool.from === to && tool.to === from }, // the reverse pair
  { turn: 1, matches: (tool, from) => tool.from === from }, // same source format
  { turn: 1, matches: (tool, _from, to) => tool.to === to }, // same target format
  { turn: 2, matches: (tool, _from, to) => tool.from === to }, // onward from the target format
  { turn: 2, matches: (tool, from) => tool.to === from }, // into the source format
];
const TURNS = [...new Set(GROUPS.map((group) => group.turn))];

// A fixed pseudo-random number for a candidate on a page: 32-bit FNV-1a of
// both ids, then MurmurHash3's finalizer, so ids that differ only in their last
// characters don't get neighbouring numbers. A group's places go to its
// candidates with the lowest numbers, so each page picks a different subset of
// a large group and every Tool lands on some page's list, where registry order
// would give every page the same first few. It depends only on the two ids, so
// a page's list is the same on every run and doesn't change with registry
// order.
function pick(pageId: string, candidateId: string): number {
  const key = `${pageId}\u0000${candidateId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The fallback list for a Tool with no curated list: at most `limit` active
// Tools of its kind that share a format with it, shared out between GROUPS.
// They show group by group, sorted by id within a group. The Tool itself is
// never listed.
export function fallbackRelatedTools<T extends Candidate>(
  current: Pick<Tool, "id" | "operation"> & { route?: string; from: string; to: string },
  candidates: readonly T[],
  limit = RELATED_TOOLS_LIMIT,
): T[] {
  const kind = kindOf(current.operation);
  const groups = GROUPS.map((group) => ({ ...group, tools: [] as T[], places: 0 }));

  for (const tool of candidates) {
    if (!tool.isActive || tool.id === current.id || tool.route === current.route) continue;
    if (kindOf(tool.operation) !== kind) continue;
    groups.find((group) => group.matches(tool, current.from, current.to))?.tools.push(tool);
  }

  for (const { tools } of groups) {
    tools.sort((a, b) => pick(current.id, a.id) - pick(current.id, b.id) || byId(a, b));
  }

  let left = limit;
  for (const turn of TURNS) {
    const sharing = groups.filter((group) => group.turn === turn);
    while (left > 0 && sharing.some((group) => group.places < group.tools.length)) {
      for (const group of sharing) {
        if (left > 0 && group.places < group.tools.length) {
          group.places += 1;
          left -= 1;
        }
      }
    }
  }

  return groups.flatMap((group) => group.tools.slice(0, group.places).sort(byId));
}

// A Lander's list: `limit` other active Landers (download Tools), sorted by id.
// The Landers in id order form a ring of n, and the one at place i lists those
// at i + stride, i + 2 × stride ... i + limit × stride, wrapping round. The
// stride is n / (limit + 1), rounded down, so the last step stays short of n:
// no Lander lists itself or another twice, each is listed by exactly `limit`
// Landers (those the same steps behind it), and a list spans the whole ring
// rather than a Lander's alphabetical neighbours. Only the ids decide it, not
// registry order.
export function landerRelatedTools<T extends Candidate>(
  current: Pick<Tool, "id" | "operation"> & { route?: string },
  candidates: readonly T[],
  limit = LANDER_RELATED_LIMIT,
): T[] {
  const others = new Map(
    candidates
      .filter(
        (tool) =>
          tool.isActive &&
          tool.operation === current.operation &&
          tool.id !== current.id &&
          tool.route !== current.route,
      )
      .map((tool) => [tool.id, tool]),
  );
  const ring = [current.id, ...others.keys()].sort();

  const count = Math.min(limit, others.size);
  const stride = Math.floor(ring.length / (count + 1));
  const place = ring.indexOf(current.id);
  const listed: T[] = [];
  for (let step = 1; step <= count; step++) {
    const id = ring[(place + step * stride) % ring.length];
    const tool = id === undefined ? undefined : others.get(id);
    if (tool) listed.push(tool);
  }
  return listed.sort(byId);
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
// The fallback matches on the registry Tool's formats, not the page content's
// labels, which differ for some Tools (`MP4` to `transcript` for `mp4` to `txt`).
export function relatedToolLinks({ toolId, route, curated }: RelatedToolsQuery): RelatedToolLink[] {
  const isOtherTool = (tool: { id: string; route: string }) =>
    (toolId ? tool.id !== toolId : true) && (route ? tool.route !== route : true);

  const curatedTools = (curated ?? [])
    .map(resolveCurated)
    .filter((tool) => tool !== null)
    .filter(isOtherTool);

  let tools: { id: string; name: string; description: string; route: string }[] = curatedTools;
  if (tools.length === 0) {
    const current = toolId ? getTool(toolId) : route ? getToolByRoute(route) : undefined;
    if (current?.operation === "download") {
      tools = landerRelatedTools({ id: current.id, operation: current.operation, route }, activeTools());
    } else if (current?.from && current.to) {
      tools = fallbackRelatedTools(
        { id: current.id, operation: current.operation, route, from: current.from, to: current.to },
        activeTools(),
      );
    }
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

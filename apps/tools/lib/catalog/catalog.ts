import type { Tool } from "@/types";

import { canonicalPath } from "../trailing-slash.ts";
import { toolHref } from "./href.ts";
import { operationsUsedBy, type ToolOperation } from "./operations.ts";
import registryData from "./tools.json" with { type: "json" };

export { toolHref };

// The Tool registry, typed once. Nothing validates, copies or freezes it at
// runtime: a Worker cold start only parses the JSON. validate.ts checks the
// shape in tests and `pnpm verify:catalog`. Callers share these objects and
// must not mutate them (tool-content.ts still does until #148's PR 3).
const registry = registryData as Tool[];

let active: readonly Tool[] | undefined;
let activeById: Map<string, Tool> | undefined;
let activeByHref: Map<string, Tool> | undefined;

// Every registry entry, published or not.
export function allTools(): readonly Tool[] {
  return registry;
}

// The Tools intended for publication (`isActive`), in registry order.
export function activeTools(): readonly Tool[] {
  active ??= registry.filter((tool) => tool.isActive);
  return active;
}

// The active Tool with this registry id.
export function getTool(id: string): Tool | undefined {
  activeById ??= new Map(activeTools().map((tool) => [tool.id, tool]));
  return activeById.get(id);
}

// The active Tool served at this path, slashed or not.
export function getToolByRoute(route: string): Tool | undefined {
  activeByHref ??= new Map(activeTools().map((tool) => [toolHref(tool), tool]));
  return activeByHref.get(canonicalPath(route));
}

// The operations that have at least one active Tool, in OPERATIONS order.
export function availableOperations(): ToolOperation[] {
  return operationsUsedBy(registry);
}

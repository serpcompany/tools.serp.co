"use client";

import { useMemo, useState, type ReactNode } from "react";

import { ToolCard } from "@/components/ToolCard";
import { ToolsSearchBar } from "@/components/ToolsSearchBar";
import type { ToolSearchEntry } from "@/lib/catalog/directory";

type ToolCategory = {
  id: string;
  name: string;
  count: number;
};

type HomeToolDirectoryProps = {
  categories: ToolCategory[];
  // What the homepage shows until someone searches or filters, rendered on
  // the server.
  children: ReactNode;
};

// Every active Tool, served by app/tool-index.json/route.ts.
const TOOL_INDEX_URL = "/tool-index.json";
const RESULTS_PAGE_SIZE = 48;

type IndexState =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; tools: readonly ToolSearchEntry[] };

let toolIndexRequest: Promise<readonly ToolSearchEntry[]> | undefined;

// Fetched once per page load, the first time someone searches or filters.
function loadToolIndex(): Promise<readonly ToolSearchEntry[]> {
  if (!toolIndexRequest) {
    toolIndexRequest = fetch(TOOL_INDEX_URL).then((response) => {
      if (!response.ok) throw new Error(`${TOOL_INDEX_URL} answered ${response.status}`);
      return response.json() as Promise<readonly ToolSearchEntry[]>;
    });
    // A failed request is retried on the next search.
    toolIndexRequest.catch(() => {
      toolIndexRequest = undefined;
    });
  }
  return toolIndexRequest;
}

// The homepage's search and filter. The page renders a few Tools per category
// as `children`; the full Tool index is fetched only when someone searches or
// picks a category, so it never ships in the page. This component must not
// import the catalog, or the registry would ship to the browser.
export function HomeToolDirectory({ categories, children }: HomeToolDirectoryProps) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [index, setIndex] = useState<IndexState>({ status: "idle" });
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);

  const isFiltering = searchQuery.trim() !== "" || selectedCategory !== "all";

  const requestIndex = () => {
    if (index.status === "ready" || index.status === "loading") return;
    setIndex({ status: "loading" });
    loadToolIndex().then(
      (tools) => setIndex({ status: "ready", tools }),
      () => setIndex({ status: "error" }),
    );
  };

  const updateSearchQuery = (query: string) => {
    setSearchQuery(query);
    setVisibleCount(RESULTS_PAGE_SIZE);
    if (query.trim() !== "") requestIndex();
  };

  const updateSelectedCategory = (category: string) => {
    setSelectedCategory(category);
    setVisibleCount(RESULTS_PAGE_SIZE);
    if (category !== "all") requestIndex();
  };

  // Filter tools based on category and search
  const filteredTools = useMemo(() => {
    if (index.status !== "ready") return [];
    const search = searchQuery.trim().toLowerCase();
    return index.tools.filter((tool) => {
      const matchesCategory = selectedCategory === "all" || tool.category === selectedCategory;
      const matchesSearch = tool.name.toLowerCase().includes(search) ||
        tool.description.toLowerCase().includes(search) ||
        (tool.terms?.some((term) => term.includes(search)) ?? false);
      return matchesCategory && matchesSearch;
    });
  }, [index, searchQuery, selectedCategory]);

  const visibleTools = filteredTools.slice(0, visibleCount);

  return (
    <section className="container py-12">
      {/* Search and Filter Bar. Focusing the search starts loading the index. */}
      <div onFocusCapture={requestIndex}>
        <ToolsSearchBar
          searchQuery={searchQuery}
          setSearchQuery={updateSearchQuery}
          categories={categories}
          selectedCategory={selectedCategory}
          setSelectedCategory={updateSelectedCategory}
        />
      </div>

      {!isFiltering ? children : null}

      {isFiltering && (index.status === "idle" || index.status === "loading") ? (
        <p className="py-12 text-center text-lg text-muted-foreground" role="status">
          Loading tools...
        </p>
      ) : null}

      {isFiltering && index.status === "error" ? (
        <div className="py-12 text-center" role="alert">
          <p className="text-lg text-muted-foreground">
            Search couldn&apos;t load. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={requestIndex}
            className="mt-4 rounded-full border border-slate-300 bg-white px-5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Try again
          </button>
        </div>
      ) : null}

      {isFiltering && index.status === "ready" ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {visibleTools.map((tool) => (
              <ToolCard key={tool.href} tool={tool} />
            ))}
          </div>

          {filteredTools.length > visibleTools.length ? (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + RESULTS_PAGE_SIZE)}
                className="rounded-full border border-slate-300 bg-white px-5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Show more ({filteredTools.length - visibleTools.length} left)
              </button>
            </div>
          ) : null}

          {filteredTools.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-lg text-muted-foreground">
                No tools found matching your criteria.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

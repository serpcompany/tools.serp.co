"use client";

import { useMemo, useState } from "react";

import { ToolCard } from "@/components/ToolCard";
import { ToolsSearchBar } from "@/components/ToolsSearchBar";
import type { DirectoryGridEntry } from "@/lib/catalog/directory";

type ToolCategory = {
  id: string;
  name: string;
  count: number;
};

type HomeToolDirectoryProps = {
  tools: readonly DirectoryGridEntry[];
  categories: ToolCategory[];
};

// The homepage's searchable Tool grid. The page passes the directory in as
// plain data; this component must not import the catalog, or the registry
// would ship to the browser.
export function HomeToolDirectory({ tools, categories }: HomeToolDirectoryProps) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Filter tools based on category and search
  const filteredTools = useMemo(() => {
    const search = searchQuery.toLowerCase();
    return tools.filter((tool) => {
      const matchesCategory = selectedCategory === "all" || tool.category === selectedCategory;
      const matchesSearch = tool.name.toLowerCase().includes(search) ||
        tool.description.toLowerCase().includes(search) ||
        (tool.terms?.some((term) => term.includes(search)) ?? false);
      return matchesCategory && matchesSearch;
    });
  }, [tools, searchQuery, selectedCategory]);

  return (
    <section className="container py-12">
      {/* Search and Filter Bar */}
      <ToolsSearchBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        categories={categories}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
      />

      {/* Tools Grid */}
      <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filteredTools.map((tool) => (
          <ToolCard key={tool.href} tool={tool} />
        ))}
      </div>

      {filteredTools.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-lg text-muted-foreground">
            No tools found matching your criteria.
          </p>
        </div>
      )}
    </section>
  );
}

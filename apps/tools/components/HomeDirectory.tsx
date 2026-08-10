'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ToolDirectoryEntry } from '@serp-tools/app-core/lib/tool-catalog';

import { ToolCard } from '@/components/ToolCard';
import { ToolsSearchBar } from '@/components/ToolsSearchBar';

type ToolCategory = {
  id: string;
  name: string;
  count: number;
};

type HomeDirectoryProps = {
  tools: readonly ToolDirectoryEntry[];
  categories: readonly ToolCategory[];
  children: ReactNode;
};

export function HomeDirectory({
  tools,
  categories,
  children,
}: HomeDirectoryProps) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTools = useMemo(() => {
    const search = searchQuery.toLowerCase();
    return tools.filter((tool) => {
      const matchesCategory =
        selectedCategory === 'all' || tool.category === selectedCategory;
      const matchesSearch =
        tool.name.toLowerCase().includes(search) ||
        tool.description.toLowerCase().includes(search) ||
        tool.tags.some((tag) => tag.toLowerCase().includes(search));
      return matchesCategory && matchesSearch;
    });
  }, [tools, searchQuery, selectedCategory]);

  return (
    <main className="min-h-screen">
      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 bg-grid-black/[0.02] dark:bg-grid-white/[0.02]" />
        <div className="container relative py-16 md:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              SERP Tools
            </h1>
          </div>
        </div>
      </section>

      <section className="container py-12">
        <ToolsSearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          categories={categories}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
        />

        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filteredTools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
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

      {children}
    </main>
  );
}

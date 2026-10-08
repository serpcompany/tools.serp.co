"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@serp-tools/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@serp-tools/ui/components/tabs";
import type { ToolLinkCategory } from "@/lib/catalog/directory";

type ToolsLinkHubTabsProps = {
  categories: readonly ToolLinkCategory[];
};

const CATEGORY_PREVIEW_LIMIT = 48;

// The link hub's tabs and "show more", rendered from the plain-data categories
// ToolsLinkHub passes in. It must not import the catalog: that would ship the
// registry to the browser.
export function ToolsLinkHubTabs({ categories }: ToolsLinkHubTabsProps) {
  const [activeCategoryId, setActiveCategoryId] = useState(categories[0]?.id ?? "");
  const [showAllTools, setShowAllTools] = useState(false);

  const activeCategory =
    categories.find((category) => category.id === activeCategoryId) ?? categories[0];

  if (!activeCategory) {
    return null;
  }

  const hasHiddenTools = activeCategory.tools.length > CATEGORY_PREVIEW_LIMIT;
  const visibleTools = showAllTools
    ? activeCategory.tools
    : activeCategory.tools.slice(0, CATEGORY_PREVIEW_LIMIT);
  const hiddenToolCount = Math.max(activeCategory.tools.length - visibleTools.length, 0);

  return (
    <section className="border-t border-slate-200 bg-gradient-to-b from-slate-100 to-slate-50 py-14 sm:py-16">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Browse All Tools</h2>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            Browse by category instead of one giant mixed list.
          </p>
        </div>

        <Tabs
          value={activeCategory.id}
          onValueChange={(value) => {
            if (!value || value === activeCategory.id) {
              return;
            }

            setActiveCategoryId(value);
            setShowAllTools(false);
          }}
          className="mt-8"
        >
          <div className="overflow-x-auto pb-2">
            <TabsList className="h-auto min-w-full justify-start gap-2 rounded-xl bg-slate-200/70 p-1.5">
              {categories.map((category) => (
                <TabsTrigger
                  key={category.id}
                  value={category.id}
                  className="h-auto rounded-lg px-3 py-2 text-xs sm:text-sm"
                >
                  <span className="font-semibold">{category.name}</span>
                  <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    {category.tools.length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{activeCategory.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{activeCategory.description}</p>
            </div>
            <Link
              href={activeCategory.href}
              className="text-sm font-medium text-blue-700 transition-colors hover:text-blue-800 hover:underline"
            >
              View {activeCategory.name} category
            </Link>
          </div>

          <div className="mb-4 text-sm text-slate-600">
            Showing {visibleTools.length} of {activeCategory.tools.length} tools
          </div>

          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visibleTools.map((tool) => (
              // Up to every Tool in the category: prefetching each one in view
              // would download its whole page payload.
              <Link
                key={tool.href}
                href={tool.href}
                prefetch={false}
                className="rounded-md px-2 py-1.5 text-sm text-slate-700 transition-colors duration-150 hover:bg-blue-50 hover:text-blue-700"
              >
                {tool.name}
              </Link>
            ))}
          </div>

          {hasHiddenTools ? (
            <div className="mt-5 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-slate-300 bg-white px-5 text-slate-700 hover:bg-slate-50"
                onClick={() => setShowAllTools((current) => !current)}
              >
                {showAllTools ? "Show fewer tools" : `Show ${hiddenToolCount} more tools`}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

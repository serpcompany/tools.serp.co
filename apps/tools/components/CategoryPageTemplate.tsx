import Link from "next/link";
import { buttonVariants } from "@serp-tools/ui/components/button";

import { ToolCard } from "@/components/ToolCard";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { categoryPageHref } from "@/lib/catalog/category-pages";
import type { CategoryPage, ToolDirectoryCategory } from "@/lib/catalog/directory";

type CategoryPageTemplateProps = {
  categoryPage: CategoryPage;
  categories: readonly ToolDirectoryCategory[];
};

// One numbered page of a category: its share of the cards, and a link to every
// other page, so each Tool is two clicks from page 1.
export default function CategoryPageTemplate({ categoryPage, categories }: CategoryPageTemplateProps) {
  const { category: activeCategory, page, pageCount, first, last, tools } = categoryPage;
  const toolCountLabel = `${activeCategory.count} ${activeCategory.count === 1 ? "tool" : "tools"}`;

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_55%),linear-gradient(180deg,_rgba(248,250,252,0.98)_0%,_rgba(255,255,255,1)_100%)]">
        <div className="container py-14 md:py-20">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-blue-600">
              Tool Category
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
              {activeCategory.title}
              {page > 1 ? <span className="text-slate-500">, page {page}</span> : null}
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
              {activeCategory.description}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <div className="rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
              {toolCountLabel} live now
            </div>
            <div className="rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm text-slate-600 shadow-sm">
              Category: {activeCategory.name}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b bg-slate-50/80">
        <div className="container py-6">
          <div className="flex flex-wrap gap-3">
            {categories.map((category) => {
              const isActive = category.id === activeCategory.id;

              return (
                <Link
                  key={category.id}
                  href={category.href}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-950"
                  }`}
                >
                  {category.name} ({category.count})
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="container py-12">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
            Browse {toolCountLabel} in {activeCategory.name}
          </h2>
          <p className="mt-3 text-base leading-7 text-slate-600">
            {pageCount > 1
              ? `Tools ${first} to ${last} of ${activeCategory.count}, page ${page} of ${pageCount}.`
              : `Every active ${activeCategory.name.toLowerCase()} tool currently available on SERP Tools is listed below.`}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {tools.map((tool) => (
            <ToolCard key={tool.href} tool={tool} />
          ))}
        </div>

        {pageCount > 1 ? (
          <CategoryPager operation={activeCategory.id} page={page} pageCount={pageCount} />
        ) : null}
      </section>

      <ToolsLinkHub />
    </main>
  );
}

type CategoryPagerProps = {
  operation: string;
  page: number;
  pageCount: number;
};

// Previous, every page number, next. A Next.js Link styled as a button: the
// stock shadcn PaginationLink mismatches on hydration from a Server Component.
function CategoryPager({ operation, page, pageCount }: CategoryPagerProps) {
  const linkClass = buttonVariants({ variant: "outline", size: "sm" });
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);

  return (
    <nav aria-label="Category pages" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={categoryPageHref(operation, page - 1)} prefetch={false} rel="prev" className={linkClass}>
          Previous
        </Link>
      ) : null}
      {pages.map((number) =>
        number === page ? (
          <span
            key={number}
            aria-current="page"
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            {number}
          </span>
        ) : (
          <Link
            key={number}
            href={categoryPageHref(operation, number)}
            prefetch={false}
            aria-label={`Page ${number}`}
            className={linkClass}
          >
            {number}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link href={categoryPageHref(operation, page + 1)} prefetch={false} rel="next" className={linkClass}>
          Next
        </Link>
      ) : null}
    </nav>
  );
}

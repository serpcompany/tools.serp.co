import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import CategoryPageTemplate from "@/components/CategoryPageTemplate";
import {
  categoryPageCount,
  categoryPageHref,
  parseCategoryPage,
} from "@/lib/catalog/category-pages";
import { categoryPage, directoryCategories } from "@/lib/catalog/directory";
import { isToolOperation } from "@/lib/catalog/operations";
import { buildCategoryMetadata } from "@/lib/metadata";

// Page 2 onward of a category (lib/catalog/category-pages.ts). Page 1 is the
// category route itself; /1/ redirects there, and a page past the last is a
// 404. Dynamic params stay on, as on the category route.

type PageProps = {
  params: Promise<{ categoryName: string; page: string }>;
};

export function generateStaticParams({ params }: { params: { categoryName: string } }) {
  const category = directoryCategories().find((candidate) => candidate.id === params.categoryName);
  if (!category) return [];
  return Array.from({ length: categoryPageCount(category.count) - 1 }, (_, index) => ({
    page: String(index + 2),
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { categoryName, page } = await params;
  const number = parseCategoryPage(page);
  const listing = number && number > 1 ? categoryPage(categoryName, number) : undefined;
  if (!listing) return {};

  // The category's own metadata, titled and canonical for this page.
  const base = buildCategoryMetadata(categoryName);
  const { title, description } = listing.category;
  const pageTitle = `${title}, page ${listing.page} of ${listing.pageCount}`;
  const pageDescription = `${description} Page ${listing.page} of ${listing.pageCount}.`;
  const canonical = categoryPageHref(categoryName, listing.page);
  return {
    ...base,
    title: `${pageTitle} | SERP Tools`,
    description: pageDescription,
    alternates: { ...base.alternates, canonical },
    openGraph: { ...base.openGraph, title: pageTitle, description: pageDescription, url: canonical },
    twitter: { ...base.twitter, title: pageTitle, description: pageDescription },
  };
}

export default async function Page({ params }: PageProps) {
  const { categoryName, page } = await params;
  if (!isToolOperation(categoryName)) {
    return notFound();
  }

  const number = parseCategoryPage(page);
  if (number === 1 && categoryPage(categoryName, 1)) {
    permanentRedirect(categoryPageHref(categoryName, 1));
  }
  const listing = number && number > 1 ? categoryPage(categoryName, number) : undefined;
  if (!listing) {
    return notFound();
  }

  return <CategoryPageTemplate categoryPage={listing} categories={directoryCategories()} />;
}

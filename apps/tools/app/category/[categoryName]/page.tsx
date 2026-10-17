import { notFound } from "next/navigation";

import CategoryPageTemplate from "@/components/CategoryPageTemplate";
import { availableOperations } from "@/lib/catalog/catalog";
import { categoryPage, directoryCategories } from "@/lib/catalog/directory";
import { isToolOperation } from "@/lib/catalog/operations";
import { buildCategoryMetadata } from "@/lib/metadata";

type PageProps = {
  params: Promise<{ categoryName: string }>;
};

export function generateStaticParams() {
  return availableOperations().map((categoryName) => ({ categoryName }));
}

export async function generateMetadata({ params }: PageProps) {
  const { categoryName } = await params;
  return buildCategoryMetadata(categoryName);
}

export default async function Page({ params }: PageProps) {
  const { categoryName } = await params;
  if (!isToolOperation(categoryName)) {
    return notFound();
  }

  // Only operations with at least one active Tool have a category. Its
  // other pages are under [page].
  const firstPage = categoryPage(categoryName, 1);
  if (!firstPage) {
    return notFound();
  }

  return <CategoryPageTemplate categoryPage={firstPage} categories={directoryCategories()} />;
}

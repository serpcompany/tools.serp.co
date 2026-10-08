import { notFound } from "next/navigation";

import CategoryPageTemplate from "@/components/CategoryPageTemplate";
import { availableOperations } from "@/lib/catalog/catalog";
import { directoryCategories, toolCardsIn } from "@/lib/catalog/directory";
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

  // Only operations with at least one active Tool have a category.
  const categories = directoryCategories();
  const activeCategory = categories.find((category) => category.id === categoryName);
  if (!activeCategory) {
    return notFound();
  }

  return (
    <CategoryPageTemplate
      activeCategory={activeCategory}
      categories={categories}
      tools={toolCardsIn(categoryName)}
    />
  );
}

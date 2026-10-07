import { notFound } from "next/navigation";

import CategoryPageTemplate from "@/components/CategoryPageTemplate";
import { activeTools, availableOperations } from "@/lib/catalog/catalog";
import { isToolOperation } from "@/lib/catalog/operations";
import { buildCategoryMetadata } from "@/lib/metadata";
import {
  buildToolDirectoryEntries,
  getToolDirectoryCategories,
  getToolsForDirectoryCategory,
} from "@/lib/tool-directory";

const tools = buildToolDirectoryEntries(activeTools());
const categories = getToolDirectoryCategories(tools);

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

  const activeCategory = categories.find((category) => category.id === categoryName);
  if (!activeCategory) {
    return notFound();
  }

  const categoryTools = getToolsForDirectoryCategory(tools, categoryName);
  if (categoryTools.length === 0) {
    return notFound();
  }

  return (
    <CategoryPageTemplate
      activeCategory={activeCategory}
      categories={categories}
      tools={categoryTools}
    />
  );
}

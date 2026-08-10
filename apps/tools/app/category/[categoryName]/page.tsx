import { notFound } from 'next/navigation';

import {
  isToolOperation,
  toolCatalog,
} from '@serp-tools/app-core/lib/tool-catalog';
import CategoryPageTemplate from '@/components/CategoryPageTemplate';
import { buildCategoryMetadata } from '@/lib/metadata';

const categories = toolCatalog.directoryCategories;
const availableOperations = toolCatalog.availableOperations;

type PageProps = {
  params: Promise<{ categoryName: string }>;
};

export function generateStaticParams() {
  return availableOperations.map((categoryName) => ({ categoryName }));
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

  const activeCategory = categories.find(
    (category) => category.id === categoryName,
  );
  if (!activeCategory) {
    return notFound();
  }

  const categoryTools = toolCatalog.getDirectoryTools(categoryName);
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

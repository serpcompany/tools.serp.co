import type { Metadata } from 'next';

import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

export function buildToolMetadata(toolId: string): Metadata {
  const tool = toolCatalog.getById(toolId);
  if (!tool?.isActive) {
    return {};
  }

  const title = tool.display.title;
  const description = tool.display.description;
  const canonical = tool.canonicalRoute;

  return {
    title: `${title} | SERP Tools`,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: 'website',
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export function buildCategoryMetadata(categoryName: string): Metadata {
  const category = toolCatalog.directoryCategories.find(
    (candidate) => candidate.id === categoryName,
  );
  if (!category) {
    return {};
  }

  const canonical = category.href;

  return {
    title: `${category.title} | SERP Tools`,
    description: category.description,
    alternates: { canonical },
    openGraph: {
      title: category.title,
      description: category.description,
      type: 'website',
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title: category.title,
      description: category.description,
    },
  };
}

export function buildCategoriesIndexMetadata(): Metadata {
  const title = 'Categories';
  const description =
    'Browse every SERP Tools category and jump into the tools available in each one.';
  const canonical = '/categories/';

  return {
    title: `${title} | SERP Tools`,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: 'website',
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

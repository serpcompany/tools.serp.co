import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

type ToolLink = {
  href: string;
  isNew: boolean;
  isPopular: boolean;
  title: string;
};

export type ToolLinkCategory = {
  description: string;
  href: string;
  id: string;
  name: string;
  title: string;
  tools: readonly ToolLink[];
};

export function getToolLinkCategories(): readonly ToolLinkCategory[] {
  return toolCatalog.directoryCategories.map((category) => {
    const tools = toolCatalog
      .getDirectoryTools(category.id)
      .map((tool) => ({
        href: tool.href,
        isNew: tool.isNew,
        isPopular: tool.isPopular,
        title: tool.name,
      }))
      .sort((a, b) => {
        if (a.isPopular !== b.isPopular) {
          return Number(b.isPopular) - Number(a.isPopular);
        }
        if (a.isNew !== b.isNew) {
          return Number(b.isNew) - Number(a.isNew);
        }
        return a.title.localeCompare(b.title);
      });

    return {
      description: category.description,
      href: category.href,
      id: category.id,
      name: category.name,
      title: category.title,
      tools,
    };
  });
}

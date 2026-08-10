import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import { HomeDirectory } from '@/components/HomeDirectory';
import { ToolsLinkHub } from '@/components/sections/ToolsLinkHub';

const categories = [
  { id: 'all', name: 'Filter', count: toolCatalog.directoryEntries.length },
  ...toolCatalog.directoryCategories.map((category) => ({
    id: category.id,
    name: category.name,
    count: category.count,
  })),
];

export default function HomePage() {
  return (
    <HomeDirectory tools={toolCatalog.directoryEntries} categories={categories}>
      <ToolsLinkHub />
    </HomeDirectory>
  );
}

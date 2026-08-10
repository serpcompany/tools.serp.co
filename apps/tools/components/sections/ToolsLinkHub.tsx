import { ToolsLinkHubClient } from '@/components/sections/ToolsLinkHubClient';
import { getToolLinkCategories } from '@/lib/tool-link-categories';
import type { RelatedTool } from '@/types';

type ToolsLinkHubProps = {
  relatedTools?: RelatedTool[];
};

const toolCategories = getToolLinkCategories();

export function ToolsLinkHub({ relatedTools }: ToolsLinkHubProps) {
  void relatedTools;
  return <ToolsLinkHubClient toolCategories={toolCategories} />;
}

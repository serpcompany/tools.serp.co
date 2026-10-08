import { ToolsLinkHubTabs } from "@/components/sections/ToolsLinkHubTabs";
import { toolLinkCategories } from "@/lib/catalog/directory";
import type { RelatedTool } from "@/types";

type ToolsLinkHubProps = {
  // Not read: the hub lists every Tool. Several pages still pass it.
  relatedTools?: RelatedTool[];
};

// "Browse All Tools": every active Tool, tabbed by category. A Server
// Component, so the registry stays on the server and the browser gets only the
// links.
export function ToolsLinkHub({ relatedTools }: ToolsLinkHubProps) {
  void relatedTools;

  return <ToolsLinkHubTabs categories={toolLinkCategories()} />;
}

import { ToolsLinkHubTabs } from "@/components/sections/ToolsLinkHubTabs";
import { toolLinkCategories } from "@/lib/catalog/directory";
import type { RelatedTool } from "@/types";

type ToolsLinkHubProps = {
  // Not read: the hub lists each category's first Tools. Several pages still
  // pass it.
  relatedTools?: RelatedTool[];
};

// "Browse All Tools": each category's first Tools, tabbed by category, with a
// link to the category's pages for the rest. A Server Component, so the
// registry stays on the server and the browser gets only the links the tabs
// show.
export function ToolsLinkHub({ relatedTools }: ToolsLinkHubProps) {
  void relatedTools;

  return <ToolsLinkHubTabs categories={toolLinkCategories()} />;
}

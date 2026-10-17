import Link from "next/link";
import { Card } from "@serp-tools/ui/components/card";
import { relatedToolLinks, type CuratedEntry } from "@/lib/catalog/related-tools";

type RelatedToolsSectionProps = {
  // Unused: ToolPageTemplate passes its content's format labels, and the
  // fallback reads the Tool's own formats from the registry instead.
  currentFrom?: string;
  currentTo?: string;
  currentRoute?: string; // to exclude current tool
  currentToolId?: string;
  relatedTools?: CuratedEntry[];
};

// The Tool's curated related list, or else up to RELATED_TOOLS_LIMIT Tools of
// the same kind that share a format with it (lib/catalog/related-tools.ts).
export function RelatedToolsSection({
  currentRoute,
  currentToolId,
  relatedTools,
}: RelatedToolsSectionProps) {
  const tools = relatedToolLinks({
    toolId: currentToolId,
    route: currentRoute,
    curated: relatedTools,
  });

  // If no related tools, don't render the section
  if (tools.length === 0) {
    return null;
  }

  return (
    <section className="py-16 bg-gradient-to-b from-white to-gray-50">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-2xl font-bold text-center mb-8 text-gray-900">
          Related Tools
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {tools.map((tool) => (
            // A dense list: don't prefetch each link in view.
            <Link key={tool.id} href={tool.href} prefetch={false}>
              <Card className="p-3 hover:shadow-md transition-all duration-200 cursor-pointer border-gray-200 hover:border-blue-300 hover:bg-blue-50/50">
                <h4 className="font-semibold text-sm text-gray-900 mb-0.5 truncate">
                  {tool.name}
                </h4>
                <p className="text-xs text-gray-600 line-clamp-1">
                  {tool.description}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

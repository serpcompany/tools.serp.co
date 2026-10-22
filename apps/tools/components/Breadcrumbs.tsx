import Link from "next/link";
import { ChevronRight } from "lucide-react";

type BreadcrumbsProps = {
  // From the first step to this page, which is the last and isn't a link.
  crumbs: readonly { name: string; path: string }[];
};

// A breadcrumb trail. A page that shows one describes the same steps in a
// BreadcrumbList (breadcrumbListStructuredData in lib/structured-data.ts).
export function Breadcrumbs({ crumbs }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-gray-600">
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          return (
            <li key={crumb.path} className="flex min-w-0 items-center gap-x-1">
              {index > 0 && <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400" />}
              {current ? (
                <span aria-current="page" className="font-medium text-gray-900">
                  {crumb.name}
                </span>
              ) : (
                <Link href={crumb.path} prefetch={false} className="hover:text-blue-700 hover:underline">
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

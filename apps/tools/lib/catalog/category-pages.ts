import { categoryHref } from "./href.ts";

// A category lists its Tools on numbered pages, as the serp HTML sitemap
// standard numbers its pages: page 1 is /category/{operation}/, page n from 2
// is /category/{operation}/{n}/. /category/{operation}/1/ redirects to page 1
// and a number past the last page is a 404. No registry import, so the
// sitemap and client code can use it.

// 120 cards fill whole rows at every grid width (1 to 5 columns) and keep a
// page's HTML well under Googlebot's 2 MB limit.
export const CATEGORY_PAGE_SIZE = 120;

export function categoryPageCount(toolCount: number): number {
  return Math.max(1, Math.ceil(toolCount / CATEGORY_PAGE_SIZE));
}

export function categoryPageHref(operation: string, page: number): string {
  return page <= 1 ? categoryHref(operation) : `${categoryHref(operation)}${page}/`;
}

// Every page of a category with `toolCount` Tools, page 1 first.
export function categoryPageHrefs(operation: string, toolCount: number): string[] {
  return Array.from({ length: categoryPageCount(toolCount) }, (_, index) =>
    categoryPageHref(operation, index + 1),
  );
}

// The page number a URL segment spells canonically ("2", never "02" or "2.0"),
// or undefined.
export function parseCategoryPage(segment: string): number | undefined {
  return /^[1-9]\d{0,5}$/.test(segment) ? Number(segment) : undefined;
}

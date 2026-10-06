import { sitemapFileResponse } from "@/lib/sitemap-route";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return sitemapFileResponse(request, "sitemap-index.xml");
}

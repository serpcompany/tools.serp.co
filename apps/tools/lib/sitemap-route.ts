import toolsData from "@serp-tools/app-core/data/tools.json";
import { NextResponse } from "next/server";

import { getSiteOrigin } from "@/lib/site-environment";
import { resolveSitemapRequest, type SitemapTool } from "@/lib/sitemap";

const CACHE_CONTROL = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

export function requestSiteOrigin(request: Request) {
  return getSiteOrigin({
    requestUrl: request.url,
    siteEnv: process.env.NEXT_PUBLIC_SITE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
}

// Serves one root-level sitemap file, such as "sitemap-tools.xml".
export function sitemapFileResponse(request: Request, fileName: string) {
  const result = resolveSitemapRequest(fileName, {
    origin: requestSiteOrigin(request),
    tools: toolsData as SitemapTool[],
  });

  if (result.type === "redirect") {
    return new NextResponse(null, {
      status: 308,
      headers: { Location: result.location, "Cache-Control": CACHE_CONTROL },
    });
  }
  if (result.type === "not-found") {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(result.body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}

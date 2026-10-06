import { NextResponse } from "next/server";

import { getRobotsTxt } from "@/lib/site-environment";
import { requestSiteOrigin } from "@/lib/sitemap-route";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const body = getRobotsTxt(process.env.NEXT_PUBLIC_SITE_ENV, requestSiteOrigin(request));

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

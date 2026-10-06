import { NextResponse } from "next/server";

import { sitemapFileResponse } from "@/lib/sitemap-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ file: string }>;
};

// Root-level sitemap files (/sitemap-tools.xml, /sitemap.xml, retired names)
// are rewritten here by next.config.mjs. Sitemaps live only at the root, so a
// direct request for /sitemaps/<file> is not found. request.url keeps the
// path the client asked for, before the rewrite, in Next.js and OpenNext.
export async function GET(request: Request, { params }: RouteContext) {
  const { file } = await params;
  const requestedPath = new URL(request.url).pathname.replace(/\/$/, "");
  if (requestedPath !== `/${file}`) {
    return new NextResponse("Not found", { status: 404 });
  }
  return sitemapFileResponse(request, file);
}

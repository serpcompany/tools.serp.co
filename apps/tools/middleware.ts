import { NextResponse, type NextRequest } from "next/server";

import {
  INTERNAL_DASHBOARD_REALM,
  isInternalDashboardAuthorized,
} from "./lib/internal-dashboard-auth";
import {
  NOINDEX_ROBOTS_TAG,
  SMOKE_TEST_HEADER,
  getCanonicalRedirectUrl,
  isProductionSite,
} from "./lib/site-environment";

function isInternalPath(pathname: string) {
  return pathname === "/internal" || pathname.startsWith("/internal/");
}

function internalDashboardResponse(request: NextRequest) {
  const authorized = isInternalDashboardAuthorized(
    request.headers.get("authorization"),
    process.env.INTERNAL_DASHBOARD_TOKEN,
  );
  if (authorized) return NextResponse.next();

  return new NextResponse("Unauthorized.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": `Basic realm="${INTERNAL_DASHBOARD_REALM}", charset="UTF-8"`,
    },
  });
}

export function middleware(request: NextRequest) {
  const siteEnv = process.env.NEXT_PUBLIC_SITE_ENV;
  const redirectUrl = getCanonicalRedirectUrl({
    requestUrl: request.url,
    siteEnv,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    hasSmokeTestHeader: request.headers.has(SMOKE_TEST_HEADER),
  });
  if (redirectUrl) return NextResponse.redirect(redirectUrl, 308);

  const response = isInternalPath(request.nextUrl.pathname)
    ? internalDashboardResponse(request)
    : NextResponse.next();
  if (!isProductionSite(siteEnv)) {
    response.headers.set("X-Robots-Tag", NOINDEX_ROBOTS_TAG);
  }
  return response;
}

export const config = {
  // Static build assets don't need host or robots handling.
  matcher: ["/((?!_next/static|_next/image).*)"],
};

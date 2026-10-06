import { NextResponse, type NextRequest } from "next/server";

import {
  INTERNAL_DASHBOARD_REALM,
  isInternalDashboardAuthorized,
} from "./lib/internal-dashboard-auth";
import {
  NOINDEX_ROBOTS_TAG,
  RELEASE_HEADER,
  SMOKE_TEST_HEADER,
  decideMiddleware,
} from "./lib/site-environment";

const RELEASE = process.env.NEXT_PUBLIC_RELEASE ?? "unknown";

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
  const decision = decideMiddleware({
    requestUrl: request.url,
    siteEnv: process.env.NEXT_PUBLIC_SITE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    hasSmokeTestHeader: request.headers.has(SMOKE_TEST_HEADER),
  });
  if (decision.type === "redirect") {
    const redirect = NextResponse.redirect(decision.location, 308);
    redirect.headers.set(RELEASE_HEADER, RELEASE);
    return redirect;
  }

  const response = decision.requireDashboardAuth
    ? internalDashboardResponse(request)
    : NextResponse.next();
  if (decision.noindex) response.headers.set("X-Robots-Tag", NOINDEX_ROBOTS_TAG);
  response.headers.set(RELEASE_HEADER, RELEASE);
  return response;
}

export const config = {
  // Static build assets don't need host or robots handling. Files in public/
  // are served by Workers Static Assets before the Worker runs; see
  // public/_headers for their robots rule.
  matcher: ["/((?!_next/static|_next/image).*)"],
};

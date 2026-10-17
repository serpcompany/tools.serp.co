import { NextResponse, type NextRequest } from "next/server";

// Written by scripts/gone-tool-routes.mjs before every build, so the bundle
// carries these routes and not the catalog (issue #322).
import goneToolRoutes from "./lib/gone-tool-routes.generated.js";
import {
  INTERNAL_DASHBOARD_REALM,
  isInternalDashboardAuthorized,
} from "./lib/internal-dashboard-auth";
import {
  GONE_PAGE_HTML,
  NOINDEX_ROBOTS_TAG,
  RELEASE_HEADER,
  SMOKE_TEST_HEADER,
  decideMiddleware,
} from "./lib/site-environment";

const RELEASE = process.env.NEXT_PUBLIC_RELEASE ?? "unknown";
const GONE_ROUTES: ReadonlySet<string> = new Set(goneToolRoutes);

// A retired Tool nobody searches for: 410 with a short page. Answered here,
// it never reaches the page cache; no-store, as on the 404 it replaces, keeps
// it out of browser and edge caches, so a Tool rebuilt later answers 200 from
// its next deploy.
function goneResponse(robotsTag: string) {
  return new NextResponse(GONE_PAGE_HTML, {
    status: 410,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": robotsTag,
      [RELEASE_HEADER]: RELEASE,
    },
  });
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
  const decision = decideMiddleware({
    requestUrl: request.url,
    siteEnv: process.env.NEXT_PUBLIC_SITE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    hasSmokeTestHeader: request.headers.has(SMOKE_TEST_HEADER),
    goneRoutes: GONE_ROUTES,
  });
  if (decision.type === "redirect") {
    const redirect = NextResponse.redirect(decision.location, 308);
    redirect.headers.set(RELEASE_HEADER, RELEASE);
    return redirect;
  }
  if (decision.type === "gone") return goneResponse(decision.robotsTag);

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

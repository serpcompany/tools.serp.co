import { NextResponse, type NextRequest } from "next/server";

import {
  INTERNAL_DASHBOARD_REALM,
  isInternalDashboardAuthorized,
} from "./lib/internal-dashboard-auth";

export function middleware(request: NextRequest) {
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

export const config = {
  matcher: ["/internal/:path*"],
};

import { NextResponse } from "next/server";

import { toolSearchIndex } from "@/lib/catalog/directory";

// The homepage search's Tool index: every active Tool's card and search terms.
// HomeToolDirectory fetches it when someone searches, so the homepage HTML
// carries only the few Tools it shows. Never indexed: it isn't a page.
export const dynamic = "force-dynamic";

let body: string | undefined;

export function GET() {
  body ??= JSON.stringify(toolSearchIndex());

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "X-Robots-Tag": "noindex",
    },
  });
}

// Next.js writes the query of the URL it renders a page for into the page (the
// initial URL in the RSC payload, the page segment key), and every request
// that arrives while a page renders, in the same isolate, gets that one
// render, whatever its own query. page-cache-filter.ts keeps such a render out
// of the cache, but a visitor's `?email=` could still reach whoever asked for
// the same page at that moment. No page reads its query on the server
// (page-request.test.mjs checks), so the Worker hands Next.js a page request
// without one. The address bar keeps it, and client code reads location.search
// as before.

import { isInternalPath } from "./site-environment.ts";
import { isExempt } from "./trailing-slash.ts";

// The URL to hand Next.js for this request, or null to hand it the request
// unchanged: a GET or HEAD for a page path (one that ends in "/", which every
// canonical page path does) loses its query. Files such as /robots.txt or
// /sitemaps/<file>.xml never end in "/".
//
// That includes the `_rsc` of a client navigation: Next.js tells an RSC
// request by its `RSC: 1` header, and `_rsc` only busts URL-keyed caches in
// front of the Worker, which still see it. Next.js 15 stable deletes it unread;
// with experimental.validateRSCRequestHeaders on, it would redirect a request
// without it (page-request.test.mjs fails if that setting comes on).
export function barePageUrl(method: string, url: URL): URL | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (url.search === "" || !isPagePath(url.pathname)) return null;
  const bare = new URL(url);
  bare.search = "";
  return bare;
}

// Paths that aren't pages, or whose server code reads the query, keep it:
// those middleware never redirects (API routes, framework paths such as
// /_next/image) and the internal dashboard. Checked on the decoded path too,
// as middleware does for /internal/.
function isPagePath(pathname: string): boolean {
  if (!pathname.endsWith("/")) return false;
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: the raw path is all there is to check.
  }
  return !isExempt(pathname) && !isExempt(decoded) && !isInternalPath(pathname);
}

type FetchHandler<Env, Ctx> = {
  fetch(request: Request, env: Env, ctx: Ctx): Promise<Response>;
};

// Wraps the OpenNext worker. A redirect (canonical host, trailing slash, a
// renamed page) carries the query to its target, so when the bare request is
// redirected, the request as it came is answered instead; a redirect renders
// no page.
export function withBarePageRequests<Env, Ctx, Handler extends FetchHandler<Env, Ctx>>(
  handler: Handler,
): Handler {
  return {
    ...handler,
    async fetch(request: Request, env: Env, ctx: Ctx) {
      const bare = barePageUrl(request.method, new URL(request.url));
      if (!bare) return handler.fetch(request, env, ctx);
      const response = await handler.fetch(new Request(bare, request), env, ctx);
      if (response.status < 300 || response.status >= 400 || !response.headers.has("location")) {
        return response;
      }
      await response.body?.cancel();
      return handler.fetch(request, env, ctx);
    },
  };
}

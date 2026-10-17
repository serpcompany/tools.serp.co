import { isProductionSite } from "@serp-tools/app-core/lib/site-env";

import { canonicalPath } from "./trailing-slash.ts";

// Which deployment this build serves. `NEXT_PUBLIC_SITE_ENV` is set per
// environment in the cf:build:* scripts and in wrangler.jsonc vars. Anything
// other than "production" is non-production: noindex, crawling disallowed, no
// analytics or ads (serp environment-configuration standard).

export { isProductionSite };

// CI reaches a deployment through its *.workers.dev host. Requests carrying
// this header skip the canonical-host redirect. It isn't secret: it only
// reveals the same public site on another host, and crawlers never send it.
export const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";

export const NOINDEX_ROBOTS_TAG = "noindex, nofollow";

// Every response names the release (commit) that served it, so the deploy
// smoke can wait until the new version answers everywhere.
export const RELEASE_HEADER = "x-tools-release";

const DEPLOYED_ENVIRONMENTS = new Set(["production", "staging"]);

type CanonicalRedirectArgs = {
  requestUrl: string;
  siteEnv: string | undefined;
  siteUrl: string | undefined;
  hasSmokeTestHeader: boolean;
};

// Deployed environments have exactly one canonical host. Returns the URL to
// 308 to when a request arrives on any other host, otherwise null. The target
// also has the canonical trailing slash, so a platform-host request takes one
// hop, not two. Local runs never change host.
export function getCanonicalRedirectUrl({
  requestUrl,
  siteEnv,
  siteUrl,
  hasSmokeTestHeader,
}: CanonicalRedirectArgs): string | null {
  if (!siteEnv || !DEPLOYED_ENVIRONMENTS.has(siteEnv) || !siteUrl || hasSmokeTestHeader) {
    return null;
  }

  const canonical = new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`);
  const url = new URL(requestUrl);
  if (url.host === canonical.host) return null;

  return `${canonical.origin}${canonicalPath(url.pathname)}${url.search}`;
}

// Checks the decoded path too, so an encoded spelling such as
// /%69nternal/tools/ never skips dashboard auth.
export function isInternalPath(pathname: string) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: the raw path is all there is to check.
  }
  return [pathname, decoded].some(
    (path) => path === "/internal" || path.startsWith("/internal/"),
  );
}

// A retired Tool's 410 is noindex in production too. It needs no nofollow:
// its one link goes to the homepage.
export const GONE_ROBOTS_TAG = "noindex";

// The body of a 410: a short page with no scripts or styles from the build,
// so it never depends on a page render.
export const GONE_PAGE_HTML = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="robots" content="noindex">',
  "<title>This tool was removed | SERP Tools</title>",
  "</head>",
  '<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">',
  "<h1>This tool was removed</h1>",
  "<p>This tool is no longer available. Every tool we still offer is on the homepage.</p>",
  '<p><a href="/">Browse all tools</a></p>',
  "</body>",
  "</html>",
  "",
].join("\n");

export type MiddlewareDecision =
  | { type: "redirect"; location: string }
  | { type: "gone"; robotsTag: string }
  | { type: "continue"; requireDashboardAuth: boolean; noindex: boolean };

type MiddlewareArgs = CanonicalRedirectArgs & {
  // Canonical (slashed) paths that answer 410 Gone: the retired Tool routes
  // nobody searches for (lib/gone-tool-routes.generated.js, issue #322).
  goneRoutes: ReadonlySet<string>;
};

// Everything middleware.ts decides, as a pure function: redirect first (so a
// platform host never prompts for the dashboard password), then 410 for a
// gone route, then whether the path needs dashboard auth and whether the
// response must be noindex. A gone route is matched only in its canonical
// spelling, so a slashless or legacy spelling still takes its 308 first.
export function decideMiddleware(args: MiddlewareArgs): MiddlewareDecision {
  const location = getCanonicalRedirectUrl(args);
  if (location) return { type: "redirect", location };

  const url = new URL(args.requestUrl);
  const path = canonicalPath(url.pathname);
  if (path !== url.pathname) {
    return { type: "redirect", location: `${url.origin}${path}${url.search}` };
  }

  if (args.goneRoutes.has(path)) {
    return {
      type: "gone",
      robotsTag: isProductionSite(args.siteEnv) ? GONE_ROBOTS_TAG : NOINDEX_ROBOTS_TAG,
    };
  }

  return {
    type: "continue",
    requireDashboardAuth: isInternalPath(new URL(args.requestUrl).pathname),
    noindex: !isProductionSite(args.siteEnv),
  };
}

type SiteOriginArgs = {
  requestUrl: string;
  siteEnv: string | undefined;
  siteUrl: string | undefined;
};

// The origin to write into absolute URLs such as sitemap entries. Staging and
// production use their canonical origin; any other run (next dev, a local
// wrangler dev) uses the origin it was requested on, so local output never
// points at a deployed host. A local cf:build inlines the production
// NEXT_PUBLIC_SITE_URL default, so the environment decides, not the URL.
export function getSiteOrigin({ requestUrl, siteEnv, siteUrl }: SiteOriginArgs): string {
  if (siteEnv && DEPLOYED_ENVIRONMENTS.has(siteEnv)) {
    // Never fall back to the request host here: a platform-host request
    // would put *.workers.dev URLs in the sitemap.
    if (!siteUrl) throw new Error(`NEXT_PUBLIC_SITE_URL is unset for ${siteEnv}`);
    return new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`).origin;
  }
  return new URL(requestUrl).origin;
}

export function getRobotsTxt(siteEnv: string | undefined, siteBase: string) {
  if (!isProductionSite(siteEnv)) {
    return ["User-agent: *", "Disallow: /"].join("\n");
  }
  return ["User-agent: *", "Allow: /", `Sitemap: ${siteBase}/sitemap-index.xml`].join("\n");
}

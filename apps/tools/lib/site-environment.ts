import { isProductionSite } from "@serp-tools/app-core/lib/site-env";

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

const DEPLOYED_ENVIRONMENTS = new Set(["production", "staging"]);

type CanonicalRedirectArgs = {
  requestUrl: string;
  siteEnv: string | undefined;
  siteUrl: string | undefined;
  hasSmokeTestHeader: boolean;
};

// Deployed environments have exactly one canonical host. Returns the URL to
// 308 to when a request arrives on any other host, otherwise null. Local runs
// never redirect.
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

  return `${canonical.origin}${url.pathname}${url.search}`;
}

export function isInternalPath(pathname: string) {
  return pathname === "/internal" || pathname.startsWith("/internal/");
}

export type MiddlewareDecision =
  | { type: "redirect"; location: string }
  | { type: "continue"; requireDashboardAuth: boolean; noindex: boolean };

// Everything middleware.ts decides, as a pure function: redirect first (so a
// platform host never prompts for the dashboard password), then whether the
// path needs dashboard auth and whether the response must be noindex.
export function decideMiddleware(args: CanonicalRedirectArgs): MiddlewareDecision {
  const location = getCanonicalRedirectUrl(args);
  if (location) return { type: "redirect", location };

  return {
    type: "continue",
    requireDashboardAuth: isInternalPath(new URL(args.requestUrl).pathname),
    noindex: !isProductionSite(args.siteEnv),
  };
}

export function getRobotsTxt(siteEnv: string | undefined, siteBase: string) {
  if (!isProductionSite(siteEnv)) {
    return ["User-agent: *", "Disallow: /"].join("\n");
  }
  return ["User-agent: *", "Allow: /", `Sitemap: ${siteBase}/sitemap-index.xml`].join("\n");
}

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

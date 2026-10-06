// A build is production only when NEXT_PUBLIC_SITE_ENV is exactly
// "production" (set by cf:build:production). Anything else, including unset,
// is non-production: noindex, no analytics, no ads. Callers pass
// `process.env.NEXT_PUBLIC_SITE_ENV` written out in full so Next.js inlines it.
export function isProductionSite(siteEnv: string | undefined): boolean {
  return siteEnv === "production";
}

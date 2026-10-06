// Workers Builds must say which environment it builds. An unset value would
// ship a non-production build (noindex, no analytics or ads) without any
// error, and a staging build of main would send production to staging.
const DEPLOYED_ENVIRONMENTS = ["staging", "production"];

export function getBuildEnvironmentError(env) {
  if (!env.WORKERS_CI) return null;

  const siteEnv = env.NEXT_PUBLIC_SITE_ENV;
  if (!DEPLOYED_ENVIRONMENTS.includes(siteEnv)) {
    const value = siteEnv ? `"${siteEnv}"` : "unset";
    return `NEXT_PUBLIC_SITE_ENV is ${value}. Build with cf:build:production or cf:build:staging.`;
  }
  if (env.WORKERS_CI_BRANCH === "main" && siteEnv !== "production") {
    return `Builds of main deploy production, but NEXT_PUBLIC_SITE_ENV is "${siteEnv}". Build with cf:build:production.`;
  }
  return null;
}

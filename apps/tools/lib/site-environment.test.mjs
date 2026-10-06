import test from "node:test";
import assert from "node:assert/strict";

import {
  decideMiddleware,
  getCanonicalRedirectUrl,
  getRobotsTxt,
  getSiteOrigin,
  isProductionSite,
} from "./site-environment.ts";

const production = { siteEnv: "production", siteUrl: "https://tools.serp.co" };
const staging = { siteEnv: "staging", siteUrl: "https://staging.tools.serp.co" };

function redirect(env, requestUrl, hasSmokeTestHeader = false) {
  return getCanonicalRedirectUrl({ ...env, requestUrl, hasSmokeTestHeader });
}

test("only an explicit production value counts as production", () => {
  assert.equal(isProductionSite("production"), true);
  for (const value of [undefined, "", "staging", "local", "Production", "prod"]) {
    assert.equal(isProductionSite(value), false, String(value));
  }
});

test("the canonical host is served without a redirect", () => {
  assert.equal(redirect(production, "https://tools.serp.co/png-to-jpg/"), null);
  assert.equal(redirect(staging, "https://staging.tools.serp.co/png-to-jpg/"), null);
});

test("platform hosts 308 to the canonical host, keeping path and query", () => {
  assert.equal(
    redirect(production, "https://tools-serp-co.serpcompany.workers.dev/png-to-jpg/?a=1"),
    "https://tools.serp.co/png-to-jpg/?a=1",
  );
  assert.equal(
    redirect(staging, "https://tools-serp-co-staging.serpcompany.workers.dev/"),
    "https://staging.tools.serp.co/",
  );
  assert.equal(
    redirect(production, "https://www.tools.serp.co/"),
    "https://tools.serp.co/",
  );
});

test("the smoke-test header skips the host redirect", () => {
  assert.equal(
    redirect(production, "https://tools-serp-co.serpcompany.workers.dev/", true),
    null,
  );
});

test("local and unknown environments never redirect", () => {
  for (const siteEnv of [undefined, "", "local", "preview"]) {
    assert.equal(
      getCanonicalRedirectUrl({
        requestUrl: "http://localhost:3000/",
        siteEnv,
        siteUrl: "http://localhost:8787",
        hasSmokeTestHeader: false,
      }),
      null,
      String(siteEnv),
    );
  }
  assert.equal(
    getCanonicalRedirectUrl({
      requestUrl: "https://example.workers.dev/",
      siteEnv: "production",
      siteUrl: undefined,
      hasSmokeTestHeader: false,
    }),
    null,
  );
});

test("robots.txt allows crawling and lists the sitemap only in production", () => {
  assert.equal(
    getRobotsTxt("production", "https://tools.serp.co"),
    "User-agent: *\nAllow: /\nSitemap: https://tools.serp.co/sitemap-index.xml",
  );
  for (const siteEnv of [undefined, "staging", "local"]) {
    assert.equal(
      getRobotsTxt(siteEnv, "https://staging.tools.serp.co"),
      "User-agent: *\nDisallow: /",
    );
  }
});

test("middleware decisions across environments, hosts and paths", () => {
  const decide = (env, requestUrl, hasSmokeTestHeader = false) =>
    decideMiddleware({ ...env, requestUrl, hasSmokeTestHeader });
  const local = { siteEnv: "local", siteUrl: "http://localhost:8787" };

  // Production on its canonical host: indexable, auth only under /internal.
  assert.deepEqual(decide(production, "https://tools.serp.co/png-to-jpg/"), {
    type: "continue",
    requireDashboardAuth: false,
    noindex: false,
  });
  for (const pathname of ["/internal", "/internal/", "/internal/tools/", "/%69nternal/tools/"]) {
    assert.deepEqual(
      decide(production, `https://tools.serp.co${pathname}`),
      { type: "continue", requireDashboardAuth: true, noindex: false },
      pathname,
    );
  }
  for (const pathname of ["/internals/", "/internal-tools/", "/tools/internal/", "/%E0%A4%A/"]) {
    assert.equal(
      decide(production, `https://tools.serp.co${pathname}`).requireDashboardAuth,
      false,
      pathname,
    );
  }

  // Staging, local and unset are noindex.
  assert.equal(decide(staging, "https://staging.tools.serp.co/").noindex, true);
  assert.equal(decide(local, "http://localhost:8787/").noindex, true);
  assert.equal(decide({ siteEnv: undefined, siteUrl: undefined }, "http://localhost:3000/").noindex, true);

  // A platform host redirects before any dashboard auth prompt.
  assert.deepEqual(decide(production, "https://tools-serp-co.serpcompany.workers.dev/internal/tools/"), {
    type: "redirect",
    location: "https://tools.serp.co/internal/tools/",
  });
  // With the smoke header the platform host is served, and still needs auth.
  assert.deepEqual(
    decide(production, "https://tools-serp-co.serpcompany.workers.dev/internal/tools/", true),
    { type: "continue", requireDashboardAuth: true, noindex: false },
  );
});

test("absolute URLs use the canonical origin when deployed and the request origin otherwise", () => {
  const origin = (env, requestUrl) => getSiteOrigin({ ...env, requestUrl });
  assert.equal(origin(production, "https://tools.serp.co/sitemap-index.xml"), "https://tools.serp.co");
  assert.equal(
    origin(production, "https://tools-serp-co.serpcompany.workers.dev/sitemap-index.xml"),
    "https://tools.serp.co",
  );
  assert.equal(
    origin(staging, "https://tools-serp-co-staging.serpcompany.workers.dev/robots.txt"),
    "https://staging.tools.serp.co",
  );
  // A local cf:build inlines the production URL default; local runs still
  // write their own origin.
  for (const siteEnv of [undefined, "", "local"]) {
    assert.equal(
      origin({ siteEnv, siteUrl: "https://tools.serp.co" }, "http://localhost:8790/sitemap-index.xml"),
      "http://localhost:8790",
      String(siteEnv),
    );
  }
  assert.equal(
    origin({ siteEnv: "production", siteUrl: undefined }, "http://localhost:3000/"),
    "http://localhost:3000",
  );
});

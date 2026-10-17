import test from "node:test";
import assert from "node:assert/strict";

import { goneToolRoutes } from "../scripts/lib/gone-tool-routes.mjs";
import {
  GONE_PAGE_HTML,
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
    decideMiddleware({ ...env, requestUrl, hasSmokeTestHeader, goneRoutes: new Set() });
  const local = { siteEnv: "local", siteUrl: "http://localhost:8787" };

  // Production on its canonical host: indexable, auth only under /internal.
  assert.deepEqual(decide(production, "https://tools.serp.co/png-to-jpg/"), {
    type: "continue",
    requireDashboardAuth: false,
    noindex: false,
  });
  for (const pathname of ["/internal/", "/internal/tools/", "/%69nternal/tools/"]) {
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

  // An unslashed page gets its slash first; the slashed page then needs auth.
  assert.deepEqual(decide(production, "https://tools.serp.co/internal"), {
    type: "redirect",
    location: "https://tools.serp.co/internal/",
  });

  // Trailing-slash rules apply on every host and environment, in one hop.
  assert.deepEqual(decide(production, "https://tools.serp.co/png-to-jpg?a=1"), {
    type: "redirect",
    location: "https://tools.serp.co/png-to-jpg/?a=1",
  });
  assert.deepEqual(decide(production, "https://tools.serp.co/robots.txt/"), {
    type: "redirect",
    location: "https://tools.serp.co/robots.txt",
  });
  assert.deepEqual(decide(production, "https://tools-serp-co.serpcompany.workers.dev/png-to-jpg"), {
    type: "redirect",
    location: "https://tools.serp.co/png-to-jpg/",
  });
  assert.deepEqual(decide(local, "http://localhost:8787/png-to-jpg"), {
    type: "redirect",
    location: "http://localhost:8787/png-to-jpg/",
  });
  // /api is never redirected on the canonical host, with or without a slash.
  for (const pathname of ["/api", "/api/", "/api/telemetry", "/api/telemetry/"]) {
    assert.equal(decide(production, `https://tools.serp.co${pathname}`).type, "continue", pathname);
  }
  // On a platform host /api still moves to the canonical host, path unchanged.
  assert.deepEqual(decide(production, "https://tools-serp-co.serpcompany.workers.dev/api/telemetry"), {
    type: "redirect",
    location: "https://tools.serp.co/api/telemetry",
  });

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

test("a gone route answers 410 after the host and slash rules, and only in its canonical spelling", () => {
  const goneRoutes = new Set(["/compress-heic/", "/png-to-png/"]);
  const decide = (env, requestUrl, hasSmokeTestHeader = false) =>
    decideMiddleware({ ...env, requestUrl, hasSmokeTestHeader, goneRoutes });
  const gone = (robotsTag) => ({ type: "gone", robotsTag });

  // Production: noindex. Staging keeps its environment-wide noindex, nofollow.
  assert.deepEqual(decide(production, "https://tools.serp.co/compress-heic/"), gone("noindex"));
  assert.deepEqual(decide(production, "https://tools.serp.co/compress-heic/?a=1"), gone("noindex"));
  assert.deepEqual(
    decide(staging, "https://staging.tools.serp.co/compress-heic/"),
    gone("noindex, nofollow"),
  );
  assert.deepEqual(decide({ siteEnv: "local", siteUrl: undefined }, "http://localhost:8826/compress-heic/"), gone("noindex, nofollow"));

  // The slashless spelling and a platform host take their one 308 first.
  assert.deepEqual(decide(production, "https://tools.serp.co/compress-heic"), {
    type: "redirect",
    location: "https://tools.serp.co/compress-heic/",
  });
  assert.deepEqual(decide(production, "https://tools-serp-co.serpcompany.workers.dev/compress-heic"), {
    type: "redirect",
    location: "https://tools.serp.co/compress-heic/",
  });
  assert.deepEqual(
    decide(production, "https://tools-serp-co.serpcompany.workers.dev/compress-heic/", true),
    gone("noindex"),
  );

  // A gone path listed in LEGACY_PAGES keeps its redirect.
  assert.deepEqual(decide(production, "https://tools.serp.co/png-to-png/"), {
    type: "redirect",
    location: "https://tools.serp.co/compress-png/",
  });

  // Other spellings and paths below it are left to the page routes (404).
  for (const pathname of ["/Compress-HEIC/", "/compress-heic/x/", "/compress-heic.html", "/api/compress-heic/"]) {
    assert.notEqual(decide(production, `https://tools.serp.co${pathname}`).type, "gone", pathname);
  }
});

test("the generator's list in middleware: retired Tools nobody searches for answer 410, everything else as before", () => {
  // A fixture catalog and keyword data, so a rebuild or a volume refresh
  // doesn't change this test; gone-tool-routes.test.mjs checks the real list.
  const tool = (id, isActive, operation = "convert") => ({ id, isActive, operation, route: `/${id}` });
  const tools = [
    tool("compress-heic", false, "compress"),
    tool("avi-to-rmvb", false),
    tool("html-to-mp3", false),
    tool("download-tellatv-videos", false, "download"),
    tool("mp4-to-mp3", true),
    tool("download-stripchat-videos", true, "download"),
  ];
  const keywords = [
    { keyword: "html to mp3", global_volume: 800, operation: "convert" },
    { keyword: "heic compressor", global_volume: 0, operation: "compress" },
  ];
  const goneRoutes = new Set(goneToolRoutes({ tools, keywords }));
  const decide = (pathname) =>
    decideMiddleware({
      ...production,
      requestUrl: `https://tools.serp.co${pathname}`,
      hasSmokeTestHeader: false,
      goneRoutes,
    });

  for (const pathname of ["/compress-heic/", "/avi-to-rmvb/"]) {
    assert.deepEqual(decide(pathname), { type: "gone", robotsTag: "noindex" }, pathname);
  }
  // Retired with keyword demand, a retired Lander (no download keywords are
  // researched), a live Tool and a made-up slug: rendered as before.
  for (const pathname of ["/html-to-mp3/", "/download-tellatv-videos/", "/mp4-to-mp3/", "/foo-to-bar-xyz/"]) {
    assert.deepEqual(
      decide(pathname),
      { type: "continue", requireDashboardAuth: false, noindex: false },
      pathname,
    );
  }
  assert.deepEqual(decide("/download-stripcha-videos/"), {
    type: "redirect",
    location: "https://tools.serp.co/download-stripchat-videos/",
  });
});

test("the 410 page is a short, self-contained noindex page", () => {
  assert.match(GONE_PAGE_HTML, /^<!doctype html>/);
  assert.match(GONE_PAGE_HTML, /<meta name="robots" content="noindex">/);
  assert.match(GONE_PAGE_HTML, /<a href="\/">/);
  assert.doesNotMatch(GONE_PAGE_HTML, /<script|<link|https?:/);
  assert.ok(GONE_PAGE_HTML.length < 1024, String(GONE_PAGE_HTML.length));
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
  // A deployed build without its URL fails instead of using the request host.
  assert.throws(
    () => origin({ siteEnv: "production", siteUrl: undefined }, "https://x.workers.dev/"),
    /NEXT_PUBLIC_SITE_URL is unset/,
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
});

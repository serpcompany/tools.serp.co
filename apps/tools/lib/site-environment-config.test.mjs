import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Drift between the build scripts, wrangler vars and routes would noindex
// production or 308 a whole canonical host away, so pin them together.
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const source = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

function buildEnv(script) {
  return Object.fromEntries(
    [...script.matchAll(/\b(NEXT_PUBLIC_[A-Z_]+)=(\S+)/g)].map(([, key, value]) => [key, value]),
  );
}

for (const env of ["staging", "production"]) {
  test(`cf:build:${env} matches the ${env} wrangler vars and route`, () => {
    const built = buildEnv(packageJson.scripts[`cf:build:${env}`]);
    const vars = wrangler.env[env].vars;
    assert.equal(built.NEXT_PUBLIC_SITE_ENV, env);
    assert.equal(vars.NEXT_PUBLIC_SITE_ENV, env);
    assert.equal(built.NEXT_PUBLIC_SITE_URL, vars.NEXT_PUBLIC_SITE_URL);
    assert.equal(new URL(vars.NEXT_PUBLIC_SITE_URL).host, wrangler.env[env].routes[0].pattern);
    assert.match(packageJson.scripts[`deploy:${env}`], new RegExp(`cf:build:${env} && wrangler deploy --env ${env}$`));
  });
}

test("the local wrangler config is never production", () => {
  assert.equal(wrangler.vars.NEXT_PUBLIC_SITE_ENV, "local");
});

test("analytics and ads are gated on the shared production check", () => {
  const gate = /isProductionSite\(process\.env\.NEXT_PUBLIC_SITE_ENV\)/;
  const gtag = source("../../../packages/app-core/src/components/gtag-manager.tsx");
  const layout = source("../../../packages/app-core/src/components/app-layout.tsx");
  assert.match(gtag, gate);
  assert.match(gtag, /if \(!isProductionSite\(process\.env\.NEXT_PUBLIC_SITE_ENV\)\) \{\s*return null;/);
  assert.match(layout, /adsenseClient && \(isProductionSite\(process\.env\.NEXT_PUBLIC_SITE_ENV\) \|\| adsenseTestMode\)/);
  for (const file of [gtag, layout]) {
    assert.doesNotMatch(file, /NODE_ENV/);
  }
});

test("middleware applies the pure decision for every non-asset route", () => {
  const middleware = source("../middleware.ts");
  assert.match(middleware, /decideMiddleware\(/);
  assert.match(middleware, /siteEnv: process\.env\.NEXT_PUBLIC_SITE_ENV/);
  assert.match(middleware, /if \(decision\.noindex\) response\.headers\.set\("X-Robots-Tag"/);
  assert.match(middleware, /matcher: \["\/\(\(\?!_next\/static\|_next\/image\)\.\*\)"\]/);
});

test("vendored static HTML is never indexed", () => {
  assert.match(source("../public/_headers"), /\/vendor\/\*\n\s+X-Robots-Tag: noindex/);
});

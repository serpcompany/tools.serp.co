import test from "node:test";
import assert from "node:assert/strict";

import { isInternalDashboardAuthorized } from "./internal-dashboard-auth.ts";

const basic = (user, password) => `Basic ${btoa(`${user}:${password}`)}`;

test("denies every request when the dashboard token is unset", () => {
  assert.equal(isInternalDashboardAuthorized(basic("admin", ""), undefined), false);
  assert.equal(isInternalDashboardAuthorized(basic("admin", "anything"), ""), false);
  assert.equal(isInternalDashboardAuthorized(null, undefined), false);
});

test("denies missing, malformed and wrong credentials", () => {
  assert.equal(isInternalDashboardAuthorized(null, "secret"), false);
  assert.equal(isInternalDashboardAuthorized("Bearer secret", "secret"), false);
  assert.equal(isInternalDashboardAuthorized("Basic !!!not-base64", "secret"), false);
  assert.equal(isInternalDashboardAuthorized(`Basic ${btoa("no-colon")}`, "secret"), false);
  assert.equal(isInternalDashboardAuthorized(basic("admin", "secre"), "secret"), false);
  assert.equal(isInternalDashboardAuthorized(basic("admin", "secret2"), "secret"), false);
});

test("allows the configured token as the Basic password with any username", () => {
  assert.equal(isInternalDashboardAuthorized(basic("admin", "secret"), "secret"), true);
  assert.equal(isInternalDashboardAuthorized(basic("", "secret"), "secret"), true);
  assert.equal(isInternalDashboardAuthorized(basic("u", "pa:ss"), "pa:ss"), true);
});

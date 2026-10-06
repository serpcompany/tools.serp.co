import test from "node:test";
import assert from "node:assert/strict";

import { isAdSenseSlotEnabled } from "./adsense-runtime.ts";

const slot = { adsenseClient: "ca-pub-123", resolvedSlot: "3136872527" };

test("isAdSenseSlotEnabled is disabled outside production when test mode is off", () => {
  for (const siteEnv of [undefined, "", "local", "staging"]) {
    assert.equal(
      isAdSenseSlotEnabled({ ...slot, adsenseTestMode: false, siteEnv }),
      false,
      String(siteEnv),
    );
  }
});

test("isAdSenseSlotEnabled is enabled in production when client and slot are present", () => {
  assert.equal(isAdSenseSlotEnabled({ ...slot, siteEnv: "production" }), true);
});

test("isAdSenseSlotEnabled is disabled in production without a client or slot", () => {
  assert.equal(
    isAdSenseSlotEnabled({ adsenseClient: "", resolvedSlot: "1", siteEnv: "production" }),
    false,
  );
  assert.equal(
    isAdSenseSlotEnabled({ adsenseClient: "ca-pub-123", siteEnv: "production" }),
    false,
  );
});

test("isAdSenseSlotEnabled is enabled outside production when test mode is on", () => {
  assert.equal(
    isAdSenseSlotEnabled({ ...slot, adsenseTestMode: true, siteEnv: "local" }),
    true,
  );
});

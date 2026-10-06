import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { beginToolRun } from "./client.ts";

// A minimal browser: localStorage, sendBeacon and the GPC flag.
let beacons;
let storage;

function setGpc(value) {
  Object.defineProperty(globalThis.navigator, "globalPrivacyControl", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  beacons = [];
  storage = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  Object.defineProperty(globalThis.navigator, "sendBeacon", {
    value: (url, data) => {
      beacons.push({ url, data });
      return true;
    },
    configurable: true,
  });
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.navigator.sendBeacon;
  delete globalThis.navigator.globalPrivacyControl;
});

test("a run sends started and succeeded events with a device id", async () => {
  setGpc(false);
  beginToolRun({ toolId: "png-to-jpg", metadata: { engine: "worker" } }).finishSuccess({});

  assert.equal(beacons.length, 2);
  const events = await Promise.all(beacons.map(({ data }) => data.text().then(JSON.parse)));
  assert.deepEqual(
    events.map((event) => event.event),
    ["tool_run_started", "tool_run_succeeded"],
  );
  assert.equal(typeof events[0].metadata.deviceId, "string");
  assert.equal(storage.size, 1);
});

test("Global Privacy Control turns telemetry off: no events, no device id", () => {
  setGpc(true);
  const run = beginToolRun({ toolId: "png-to-jpg" });
  run.finishSuccess({});
  run.finishFailure({ errorCode: "convert_failed" });

  assert.equal(beacons.length, 0);
  assert.equal(storage.size, 0);
});

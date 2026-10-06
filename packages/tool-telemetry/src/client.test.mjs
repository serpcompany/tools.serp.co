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
  const pageHideListeners = new Set();
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener: (type, listener) => type === "pagehide" && pageHideListeners.add(listener),
    removeEventListener: (type, listener) => pageHideListeners.delete(listener),
    hidePage: () => [...pageHideListeners].forEach((listener) => listener()),
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

async function sentEvents() {
  return Promise.all(beacons.map(({ data }) => data.text().then(JSON.parse)));
}

test("an extension prompt is a hand-off, not a failure", async () => {
  setGpc(false);
  beginToolRun({ toolId: "download-loom-videos" }).finishHandoff({
    reason: "downloader_extension_only",
  });

  const events = await sentEvents();
  assert.deepEqual(events.map((event) => event.event), ["tool_run_started", "tool_run_handed_off"]);
  assert.equal(events[1].errorCode, "downloader_extension_only");
});

test("a run still open when the page goes away is abandoned", async () => {
  setGpc(false);
  beginToolRun({ toolId: "webm-to-mp3" });
  globalThis.window.hidePage();

  const events = await sentEvents();
  assert.deepEqual(events.map((event) => event.event), ["tool_run_started", "tool_run_abandoned"]);
});

test("a run ends once: later finishes and page hides send nothing", async () => {
  setGpc(false);
  const run = beginToolRun({ toolId: "png-to-jpg" });
  run.finishSuccess({ outputBytes: 10 });
  run.finishFailure({ errorCode: "convert_failed" });
  globalThis.window.hidePage();

  const events = await sentEvents();
  assert.deepEqual(events.map((event) => event.event), ["tool_run_started", "tool_run_succeeded"]);
});

test("Global Privacy Control turns telemetry off: no events, no device id", () => {
  setGpc(true);
  const run = beginToolRun({ toolId: "png-to-jpg" });
  run.finishSuccess({});
  run.finishFailure({ errorCode: "convert_failed" });

  assert.equal(beacons.length, 0);
  assert.equal(storage.size, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A window and document just big enough for the loader, and a fresh copy of
// the module per test (its state is module-level, like the page's).
let instance = 0;
async function setup({ readyState = "loading" } = {}) {
  const timers = [];
  const appended = [];
  const listeners = [];
  const target = new EventTarget();
  globalThis.window = {
    addEventListener(type, listener, options) {
      listeners.push(type);
      target.addEventListener(type, listener, options);
    },
    removeEventListener(type, listener, options) {
      target.removeEventListener(type, listener, options);
    },
    dispatch(type) {
      target.dispatchEvent(new Event(type));
    },
    setTimeout(callback, ms) {
      timers.push({ callback, ms });
      return timers.length;
    },
  };
  globalThis.document = {
    readyState,
    createElement: (tagName) => ({ tagName }),
    head: { appendChild: (element) => appended.push(element) },
  };
  instance += 1;
  const scripts = await import(`./third-party-scripts.ts?instance=${instance}`);
  return { scripts, timers, appended, listeners, window: globalThis.window };
}

test("scripts wait for the visitor's first interaction, then run once", async () => {
  const { scripts, timers, window } = await setup();
  const calls = [];
  scripts.whenPageInteractive(() => calls.push("gtm"));
  scripts.whenPageInteractive(() => calls.push("adsense"));
  assert.deepEqual(calls, []);
  assert.equal(timers.length, 0, "no quiet timer before the load event");

  window.dispatch("pointerdown");
  assert.deepEqual(calls, ["gtm", "adsense"]);
  window.dispatch("keydown");
  window.dispatch("scroll");
  assert.deepEqual(calls, ["gtm", "adsense"]);

  scripts.whenPageInteractive(() => calls.push("later"));
  assert.deepEqual(calls, ["gtm", "adsense", "later"], "runs at once after the first interaction");
});

test("every first-interaction kind releases the scripts", async () => {
  for (const type of ["pointerdown", "keydown", "touchstart", "scroll", "wheel"]) {
    const { scripts, window } = await setup();
    let ran = false;
    scripts.whenPageInteractive(() => (ran = true));
    window.dispatch(type);
    assert.equal(ran, true, type);
  }
});

test("without an interaction, scripts load THIRD_PARTY_QUIET_MS after the load event", async () => {
  const { scripts, timers, window } = await setup();
  let ran = false;
  scripts.whenPageInteractive(() => (ran = true));
  window.dispatch("load");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, scripts.THIRD_PARTY_QUIET_MS);
  assert.ok(scripts.THIRD_PARTY_QUIET_MS >= 3_000, "well after the page has loaded");
  assert.equal(ran, false);
  timers[0].callback();
  assert.equal(ran, true);
});

test("the quiet timer starts at once when the page has already loaded", async () => {
  const { scripts, timers } = await setup({ readyState: "complete" });
  scripts.whenPageInteractive(() => {});
  scripts.whenPageInteractive(() => {});
  assert.equal(timers.length, 1, "one timer for every waiting script");
});

test("a cancelled callback never runs", async () => {
  const { scripts, window } = await setup();
  let ran = false;
  const cancel = scripts.whenPageInteractive(() => (ran = true));
  cancel();
  window.dispatch("pointerdown");
  assert.equal(ran, false);
});

test("loadScript appends one async script per src", async () => {
  const { scripts, appended } = await setup();
  const src = scripts.adsenseScriptSrc("ca-pub-1");
  assert.equal(src, "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1");
  scripts.loadAdSenseScript(src);
  scripts.loadAdSenseScript(src);
  assert.equal(appended.length, 1);
  assert.deepEqual(appended[0], { tagName: "script", async: true, src, crossOrigin: "anonymous" });
});

test("loadGoogleTagManager pushes the gtm.js start event once, then loads the container", async () => {
  const { scripts, appended, window } = await setup();
  const src = scripts.googleTagManagerScriptSrc("GTM-TEST");
  assert.equal(src, "https://www.googletagmanager.com/gtm.js?id=GTM-TEST");
  scripts.loadGoogleTagManager(src);
  scripts.loadGoogleTagManager(src);
  assert.equal(window.dataLayer.length, 1);
  assert.equal(window.dataLayer[0].event, "gtm.js");
  assert.equal(typeof window.dataLayer[0]["gtm.start"], "number");
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, src);
  assert.equal(appended[0].crossOrigin, undefined);
});

// next/script's afterInteractive strategy preloads its src with the page;
// the layout must not go back to it, nor to @next/third-parties (which uses it).
test("the layout loads GTM and AdSense through the deferred loader", () => {
  const read = (file) => readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");
  const layout = read("app-layout.tsx");
  const gtm = read("gtag-manager.tsx");
  for (const source of [layout, gtm]) {
    assert.doesNotMatch(source, /next\/script|@next\/third-parties/);
  }
  assert.match(layout, /<AdSenseScript src=\{adsenseScriptSrc\(adsenseClient\)\} \/>/);
  assert.match(gtm, /<GoogleTagManagerScript src=\{googleTagManagerScriptSrc\(gtmId\)\} \/>/);
  assert.doesNotMatch(gtm, /^"use client"/m, "a Server Component, so the ID is in the HTML");
});

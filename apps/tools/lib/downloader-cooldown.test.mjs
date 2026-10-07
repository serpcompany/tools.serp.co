import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOWNLOADER_RATE_LIMIT_WINDOW_MS } from "./downloader-contract.js";
import { getDownloaderCooldownEndsAtMs } from "./downloader-cooldown.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const now = 1_760_000_000_000;

test("no downloader countdown runs while an attempt is processing", () => {
  assert.equal(getDownloaderCooldownEndsAtMs("loading", { now }), null);
  assert.equal(getDownloaderCooldownEndsAtMs("processing", { now }), null);
});

test("the downloader cooldown starts when an attempt completes or fails", () => {
  assert.equal(
    getDownloaderCooldownEndsAtMs("completed", { now }),
    now + DOWNLOADER_RATE_LIMIT_WINDOW_MS,
  );
  assert.equal(
    getDownloaderCooldownEndsAtMs("error", { now }),
    now + DOWNLOADER_RATE_LIMIT_WINDOW_MS,
  );
  assert.equal(
    getDownloaderCooldownEndsAtMs("completed", { now, windowMs: 1_000 }),
    now + 1_000,
  );
});

test("a rate-limited attempt counts down the server's remaining wait", () => {
  assert.equal(
    getDownloaderCooldownEndsAtMs("error", { now, retryAfterMs: 42_000 }),
    now + 42_000,
  );

  for (const retryAfterMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
    assert.equal(
      getDownloaderCooldownEndsAtMs("error", { now, retryAfterMs }),
      now + DOWNLOADER_RATE_LIMIT_WINDOW_MS,
      `expected a full window when the server wait is ${retryAfterMs}`,
    );
  }
});

test("downloader pages start the cooldown when the attempt ends, not at submit", () => {
  const hero = read("../components/DownloaderPageHero.tsx");
  const tool = read("../components/VideoDownloaderTool.tsx");

  // Revealing ads at submit opens the product prompt but leaves the cooldown alone.
  const revealHandler = hero.match(
    /function handleAdsVisibleChange\(visible: boolean\) \{[\s\S]*?\n {2}\}/,
  );
  assert.ok(revealHandler, "expected the hero to own the ad-reveal handler");
  assert.doesNotMatch(revealHandler[0], /setCooldownEndsAtMs/);
  assert.match(hero, /onCooldownChange={setCooldownEndsAtMs}/);

  // showAttempt is the only place the tool moves the cooldown, and it applies the rule above.
  assert.equal(tool.match(/onCooldownChange\?\.\(/g)?.length, 1);
  assert.match(
    tool,
    /function showAttempt\([\s\S]*?onCooldownChange\?\.\(\s*getDownloaderCooldownEndsAtMs\(file\.status/,
  );

  // The attempt start and every ending go through showAttempt; plain
  // setCurrentFile calls only report download progress.
  assert.match(tool, /showAttempt\(\{[^}]*status: "loading",\s*message: "Starting download\.\.\."/);
  for (const update of tool.match(/setCurrentFile\([\s\S]*?\);/g) ?? []) {
    assert.doesNotMatch(update, /status: "(completed|error)"|=>/);
  }
  assert.match(tool, /showAttempt\(\{[^}]*status: "completed"/);

  // Both failure branches pass the server's remaining wait along.
  const catchBlock = tool.match(/\} catch \(err\) \{[\s\S]*?\} finally \{/)?.[0] ?? "";
  assert.equal(catchBlock.match(/showAttempt\(/g)?.length, 2);
  assert.equal(catchBlock.match(/\},\s*retryAfterMs\s*\);/g)?.length, 2);
  assert.match(tool, /retryAfterMs = data\.retryAfterMs/);

  // While the attempt runs, the panel keeps its ad and extension prompt.
  assert.match(tool, /const showCooldownPanel = busy \|\| cooldownEndsAtMs !== null;/);
});

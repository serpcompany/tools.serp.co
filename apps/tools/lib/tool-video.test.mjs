import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import process from "node:process";

import { getTool } from "./catalog/catalog.ts";

// lib/tool-video.ts imports by the "@/" alias (tsconfig paths), which Node
// doesn't read: resolve it to apps/tools/ with the extension Next.js adds.
const appRoot = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("@/")) return next(specifier, context);
    const base = new URL(specifier.slice(2), appRoot).href;
    const url = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(
      (candidate) => /\.tsx?$/.test(candidate) && existsSync(new URL(candidate)),
    );
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});
const { shownToolVideo } = await import("./tool-video.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const player = source("../components/ToolVideoPlayer.tsx");
const section = source("../components/sections/ToolVideoSection.tsx");
const template = source("../components/ToolPageTemplate.tsx");
const card = source("../components/videos/VideoCard.tsx");

test("a converter page shows its Tool's video unless the page is cross-origin isolated", () => {
  const webpToPng = getTool("webp-to-png");
  assert.ok(webpToPng.video);
  assert.equal(shownToolVideo(webpToPng, webpToPng.video), webpToPng.video);
  assert.equal(shownToolVideo(webpToPng, undefined), undefined);
  // A transcription Tool's page is isolated when FFmpeg runs multi-threaded
  // (lib/coep.ts), and YouTube's player can't load in an isolated page.
  const transcript = getTool("mp4-to-transcript");
  const isolated = process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD !== "true";
  assert.equal(shownToolVideo(transcript, webpToPng.video), isolated ? undefined : webpToPng.video);
});

test("the converter page's player is in the server HTML and loads lazily, without autoplay", () => {
  assert.doesNotMatch(player, /"use client"/);
  // One iframe, always rendered, from YouTube's privacy-enhanced host.
  assert.equal(player.match(/<iframe\b/g)?.length, 1);
  assert.match(player, /src=\{`\$\{youtubeEmbedUrl\(youtubeId\)\}\?rel=0`\}/);
  assert.doesNotMatch(player, /autoplay=1/);
  assert.match(player, /loading="lazy"/);
  // The box keeps the video's 16:9 shape, so nothing moves as it loads.
  assert.match(player, /aspect-video/);
});

test("cards show the small hqdefault thumbnail; only the JSON-LD and video sitemap name the 1280 x 720 one", () => {
  // WatchVideo.thumbnailUrl is maxresdefault, for Google. The cards are sized
  // for hqdefault (YOUTUBE_THUMBNAIL_WIDTH x HEIGHT).
  assert.match(card, /src=\{youtubeThumbnailUrl\(/);
  assert.doesNotMatch(card, /thumbnailUrl\}|MaxresThumbnail/);
});

test("the converter page shows its video right under the converter and links it to its watch page", () => {
  assert.match(section, /href=\{watchPath\(toolId, video\.id\)\}/);
  assert.match(section, /href=\{VIDEOS_PATH\}/);
  assert.ok(
    template.indexOf("<HeroConverter") < template.indexOf("<ToolVideoSection") &&
      template.indexOf("<ToolVideoSection") < template.indexOf("<AboutFormatsSection"),
    "the video follows the converter, before every other section",
  );
  assert.match(template, /shownToolVideo\(tool, video\)/);
});

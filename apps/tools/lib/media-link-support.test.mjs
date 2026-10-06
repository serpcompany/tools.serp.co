import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getUnsupportedTranscriptionLink,
  isYouTubeHost,
  MEDIA_LINK_UNAVAILABLE,
  YOUTUBE_LINK_UNSUPPORTED,
} from "./media-link-support.ts";

const TRANSCRIPTION_TOOL_IDS = [
  "audio-to-text",
  "audio-to-transcript",
  "mp3-to-transcript",
  "mp4-to-transcript",
  "tiktok-to-transcript",
  "video-to-transcript",
  "youtube-to-transcript",
  "youtube-to-transcript-generator",
];

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("YouTube-family hosts are recognised", () => {
  for (const host of [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtube-nocookie.com",
    "WWW.YOUTUBE.COM.",
  ]) {
    assert.equal(isYouTubeHost(host), true, host);
  }
  for (const host of ["notyoutube.com", "youtube.com.evil.example", "upload.wikimedia.org"]) {
    assert.equal(isYouTubeHost(host), false, host);
  }
});

test("transcription requests for YouTube links get a plain explanation", () => {
  const url = new URL("https://www.youtube.com/watch?v=3Is2P90qVa0");

  assert.equal(getUnsupportedTranscriptionLink(url, undefined), YOUTUBE_LINK_UNSUPPORTED);
  assert.equal(getUnsupportedTranscriptionLink(url, "downloader"), null);
  assert.equal(
    getUnsupportedTranscriptionLink(new URL("https://example.com/talk.mp3"), undefined),
    null,
  );
});

test("user-facing messages carry no internal details", () => {
  for (const { message } of [YOUTUBE_LINK_UNSUPPORTED, MEDIA_LINK_UNAVAILABLE]) {
    assert.doesNotMatch(message, /JSON|token|yt-dlp|stderr|binary|HTTP \d/i);
  }
});

test("media-fetch turns YouTube away before fetching and hides internal errors", () => {
  const route = read("../app/api/media-fetch/route.ts");
  const guard = route.indexOf("getUnsupportedTranscriptionLink(targetUrl, payload.consumer)");
  assert.ok(guard > 0, "route checks the link before fetching");
  assert.ok(guard < route.indexOf("await assertPublicUrl(targetUrl)"));
  assert.doesNotMatch(route, /buildJsonErrorResponse\(\{ error: message \}, 500\)/);
  assert.match(route, /MEDIA_LINK_UNAVAILABLE\.message/);
});

test("the transcription UI does not advertise YouTube links", () => {
  const component = read("../components/TranscribeTool.tsx");
  assert.doesNotMatch(component, /YouTube, SoundCloud, or direct file/);
  assert.doesNotMatch(component, /Supports public links/);
  assert.match(component, /getUnsupportedTranscriptionLink\(parsedUrl/);
});

test("every transcription page states that webpage links are not supported", () => {
  const tools = JSON.parse(read("../../../packages/app-core/src/data/tools.json"));
  for (const toolId of TRANSCRIPTION_TOOL_IDS) {
    const tool = tools.find((entry) => entry.id === toolId);
    assert.ok(tool, `${toolId} exists`);
    const copy = JSON.stringify(tool.content);
    assert.doesNotMatch(
      copy,
      /Yes for public links|uploads or public links|public links or uploads|paste a public link/i,
      `${toolId} still implies webpage-link support`,
    );
    assert.match(copy, /YouTube, (TikTok|SoundCloud)[^"]*not supported/, `${toolId} states the limitation`);
  }
});

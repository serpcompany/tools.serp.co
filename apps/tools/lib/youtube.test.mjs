import test from "node:test";
import assert from "node:assert/strict";

import {
  durationLabel,
  durationSeconds,
  uploadDateLabel,
  youtubeEmbedUrl,
  youtubeMaxresThumbnailUrl,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from "./youtube.ts";

test("a video's URLs: the privacy-enhanced player, its two thumbnails and its YouTube page", () => {
  assert.equal(youtubeEmbedUrl("FJkyr2TEUs0"), "https://www.youtube-nocookie.com/embed/FJkyr2TEUs0");
  // The small one pages show, and the 1280 x 720 one Google is given.
  assert.equal(youtubeThumbnailUrl("FJkyr2TEUs0"), "https://i.ytimg.com/vi/FJkyr2TEUs0/hqdefault.jpg");
  assert.equal(youtubeMaxresThumbnailUrl("FJkyr2TEUs0"), "https://i.ytimg.com/vi/FJkyr2TEUs0/maxresdefault.jpg");
  assert.equal(youtubeWatchUrl("FJkyr2TEUs0"), "https://www.youtube.com/watch?v=FJkyr2TEUs0");
});

test("an ISO 8601 duration in seconds, as the video sitemap takes it", () => {
  assert.equal(durationSeconds("PT28S"), 28);
  assert.equal(durationSeconds("PT0M28S"), 28);
  assert.equal(durationSeconds("PT3M9S"), 189);
  assert.equal(durationSeconds("PT1H2M3S"), 3723);
  assert.equal(durationSeconds("PT2H"), 7200);
  for (const invalid of ["", "PT", "28", "P1D", "PT1.5S", "pt28s"]) {
    assert.ok(Number.isNaN(durationSeconds(invalid)), invalid);
  }
});

test("a duration as a player shows it", () => {
  assert.equal(durationLabel("PT28S"), "0:28");
  assert.equal(durationLabel("PT90S"), "1:30");
  assert.equal(durationLabel("PT3M9S"), "3:09");
  assert.equal(durationLabel("PT1H2M3S"), "1:02:03");
  assert.equal(durationLabel("PT"), "");
});

test("an upload date is shown as the day it names, in its own time zone", () => {
  assert.equal(uploadDateLabel("2026-10-22T00:15:20-07:00"), "October 22, 2026");
  assert.equal(uploadDateLabel("2026-01-01T23:59:59+14:00"), "January 1, 2026");
  assert.equal(uploadDateLabel("2026-13-01T00:00:00Z"), "");
  assert.equal(uploadDateLabel("yesterday"), "");
});

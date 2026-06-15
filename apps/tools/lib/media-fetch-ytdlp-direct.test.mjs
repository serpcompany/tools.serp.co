import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(
  new URL("../app/api/media-fetch/route.ts", import.meta.url),
  "utf8",
);

test("media-fetch yt-dlp fallback streams direct media URLs instead of downloading temp files first", () => {
  assert.match(routeSource, /async function resolveYtDlpMediaFormat/);
  assert.match(routeSource, /download: false/);
  assert.match(routeSource, /dumpSingleJson: true/);
  assert.doesNotMatch(routeSource, /await youtubedl\(targetUrl\.toString\(\), \{\s*output:/s);
});

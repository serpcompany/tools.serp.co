import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const nativeSource = readFileSync(
  new URL("../app/api/media-fetch/native-ytdlp.ts", import.meta.url),
  "utf8",
);

test("native yt-dlp extraction resolves direct media URLs instead of downloading temp files first", () => {
  assert.match(nativeSource, /function resolveYtDlpMediaFormat/);
  assert.match(nativeSource, /download: false/);
  assert.match(nativeSource, /dumpSingleJson: true/);
  assert.doesNotMatch(nativeSource, /await youtubedl\(targetUrl\.toString\(\), \{\s*output:/s);
});

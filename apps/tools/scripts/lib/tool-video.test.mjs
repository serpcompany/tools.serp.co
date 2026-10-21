import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildScript, captionChunks, chapters, resolveBeat, spokenRoute, toSrt, youtubeMetadata } from "./tool-video.mjs";

const formats = JSON.parse(readFileSync(new URL("../../content/formats.json", import.meta.url), "utf8"));
const jpgToPng = { id: "jpg-to-png", operation: "convert", route: "/jpg-to-png", from: "jpg", to: "png" };
const compressJpg = { id: "compress-jpg", operation: "compress", route: "/compress-jpg", from: "jpg", to: "jpg" };

test("a route is read out by its format names", () => {
  assert.equal(spokenRoute("/jpg-to-png", formats), "JPG to PNG");
});

test("a converter's script opens and closes on cards and speaks the page's address", () => {
  const script = buildScript(jpgToPng, formats);
  assert.deepEqual(script.map((beat) => beat.kind), ["card", "page", "page", "page", "page", "page", "page", "card"]);
  const open = resolveBeat(script.find((beat) => beat.id === "open"));
  assert.equal(open.say, "First, open tools dot serp dot co slash JPG to PNG.");
  assert.equal(open.caption, "First, open tools.serp.co/jpg-to-png.");
  assert.match(resolveBeat(script.find((beat) => beat.id === "result")).say, /lossless compression and alpha transparency/);
});

test("a compressor's download line reports the sizes the run produced", () => {
  const download = buildScript(compressJpg, formats).find((beat) => beat.id === "download");
  const line = resolveBeat(download, { inputBytes: 4_200_000, outputBytes: 380_000 });
  assert.match(line.say, /from 4\.2 megabytes to 380 kilobytes/);
  assert.match(line.caption, /from 4\.2 MB to 380 KB/);
});

test("captions break after punctuation and share the line's time by word count", () => {
  const chunks = captionChunks("Here's how to convert JPG to PNG, for free, right in your browser.", 0, 6);
  assert.deepEqual(
    chunks.map((chunk) => chunk.text),
    ["Here's how to convert JPG to PNG,", "for free, right in your browser."],
  );
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1).end, 6);
  assert.match(toSrt(chunks), /^1\n00:00:00,000 --> 00:00:03,231\n/);
});

test("chapters start at 0:00, last at least 10 s, and need three", () => {
  const timeline = [
    { start: 0, chapter: "Intro" },
    { start: 5, chapter: "Open the tool" },
    { start: 11, chapter: "Add your file" },
    { start: 22, chapter: "Download" },
    { start: 44, chapter: "Outro" },
  ];
  assert.deepEqual(chapters(timeline, 50), [
    { start: 0, title: "Intro" },
    { start: 11, title: "Add your file" },
    { start: 22, title: "Download" },
  ]);
  assert.deepEqual(chapters(timeline.slice(0, 2), 12), []);
});

test("YouTube metadata links the canonical page", () => {
  const metadata = youtubeMetadata(jpgToPng, formats, { timeline: [], duration: 50 });
  assert.equal(metadata.title, "How to Convert JPG to PNG (Free, No Upload)");
  assert.equal(metadata.url, "https://tools.serp.co/jpg-to-png/");
  assert.match(metadata.description, /https:\/\/tools\.serp\.co\/jpg-to-png\//);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tools = JSON.parse(
  readFileSync(
    new URL("./catalog/tools.json", import.meta.url),
    "utf8",
  ),
);
const downloaderToolSource = readFileSync(
  new URL("../components/VideoDownloaderTool.tsx", import.meta.url),
  "utf8",
);

test("generic video downloader is configured as the broad download route", () => {
  const tool = tools.find((entry) => entry.id === "video-downloader");

  assert.ok(tool);
  assert.equal(tool.operation, "download");
  assert.equal(tool.route, "/video-downloader");
  assert.equal(tool.isActive, true);
  assert.match(tool.content.tool.subtitle, /many public platforms/i);
  assert.match(tool.content.faqs[0].answer, /many supported platforms/i);
});

test("generic video downloader renders configured broad public host support copy", () => {
  assert.match(downloaderToolSource, /subtitle &&/);
  assert.match(downloaderToolSource, /{subtitle}/);
});

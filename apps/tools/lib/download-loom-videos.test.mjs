import test from "node:test";
import assert from "node:assert/strict";
import { toolCatalog } from "../../../packages/app-core/src/lib/tool-catalog.ts";

test("loom video downloader is registered as an active download tool", () => {
  const tool = toolCatalog.getById("download-loom-videos");

  assert.ok(tool, "expected download-loom-videos tool to exist");
  assert.equal(tool.operation, "download");
  assert.equal(tool.isActive, true);
  assert.equal(tool.route, "/download-loom-videos");
  assert.match(tool.content?.tool.title ?? "", /Loom Video Downloader/);
});

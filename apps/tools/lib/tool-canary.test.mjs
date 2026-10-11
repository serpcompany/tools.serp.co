import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CANARY_TOOLS, failingCanaries, uncoveredPaths } from "../scripts/lib/tool-canary.mjs";
import { STATUS_INPUTS } from "../scripts/lib/tool-status.mjs";
import { engineFor, handlerFor, loadFixtures, planTool, scanPageHandlers } from "../scripts/lib/tool-sweep.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => JSON.parse(readFileSync(path.join(appRoot, relative), "utf8"));
const canaryIds = Object.keys(CANARY_TOOLS);

// The committed sweep rows of live Tools, with the engine and handler the
// current code assigns rather than the ones recorded when they were measured.
function liveRows() {
  const handlers = scanPageHandlers(path.join(appRoot, "app"));
  const tools = new Map(read(STATUS_INPUTS.catalog).filter((tool) => tool.isActive).map((tool) => [tool.id, tool]));
  return read(STATUS_INPUTS.sweep).results.flatMap((row) => {
    const tool = tools.get(row.id);
    if (!tool) return [];
    const handler = handlerFor(tool, handlers);
    return [{ ...row, handler, engine: engineFor(tool, handler) }];
  });
}

test("every canary is a live Tool the sweep can run, and it passes in the committed results", () => {
  const handlers = scanPageHandlers(path.join(appRoot, "app"));
  const fixtures = loadFixtures(path.join(appRoot, "benchmarks"));
  const tools = new Map(read(STATUS_INPUTS.catalog).filter((tool) => tool.isActive).map((tool) => [tool.id, tool]));
  for (const id of canaryIds) {
    const tool = tools.get(id);
    assert.ok(tool, `${id} is not a live Tool`);
    const plan = planTool(tool, { handlers, fixtures, timeoutMs: 1, ffmpegTimeoutMs: 1 });
    assert.equal(plan.status, undefined, `the sweep doesn't run ${id}: ${plan.reason}`);
  }
  assert.deepEqual(failingCanaries(liveRows(), canaryIds), [], "a canary must pass in tool-sweep-results.json");
});

test("every engine and page with a passing Tool has a canary", () => {
  assert.deepEqual(
    uncoveredPaths(liveRows(), canaryIds),
    { engines: [], handlers: [] },
    "add a passing Tool for each to CANARY_TOOLS in scripts/lib/tool-canary.mjs",
  );
});

test("a canary fails unless its row passes, including when it has no row", () => {
  const rows = [
    { id: "a-to-b", status: "pass" },
    { id: "c-to-d", status: "error", error: "FFmpeg failed", detail: "Unknown encoder" },
    { id: "e-to-f", status: "timeout" },
  ];
  assert.deepEqual(failingCanaries(rows, ["a-to-b", "c-to-d", "e-to-f", "g-to-h"]), [
    { id: "c-to-d", status: "error", error: "FFmpeg failed", detail: "Unknown encoder" },
    { id: "e-to-f", status: "timeout", error: null },
    { id: "g-to-h", status: "missing", error: "the sweep has no row for it" },
  ]);
});

test("an engine or page is covered only by a canary that uses it; failing Tools need none", () => {
  const rows = [
    { id: "mp4-to-webm", status: "pass", engine: "ffmpeg-wasm", handler: "ToolPageRenderer" },
    { id: "png-to-jpg", status: "pass", engine: "browser-raster", handler: "ToolPageRenderer" },
    { id: "csv-to-json", status: "pass", engine: "table-convert", handler: "TableConvertLanding" },
    { id: "compress-pdf", status: "error", engine: "server-pdf-compress", handler: "ToolPageRenderer" },
    { id: "download-x", status: "skipped", engine: null, handler: "DownloaderPageRenderer" },
  ];
  assert.deepEqual(uncoveredPaths(rows, ["mp4-to-webm"]), {
    engines: ["browser-raster", "table-convert"],
    handlers: ["TableConvertLanding"],
  });
  assert.deepEqual(uncoveredPaths(rows, ["mp4-to-webm", "png-to-jpg", "csv-to-json"]), { engines: [], handlers: [] });
});

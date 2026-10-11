import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CANARY_TOOLS, UNGUARDED, failingCanaries, uncoveredPaths } from "../scripts/lib/tool-canary.mjs";
import { STATUS_INPUTS } from "../scripts/lib/tool-status.mjs";
import { loadFixtures, planTool, scanPageHandlers } from "../scripts/lib/tool-sweep.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => JSON.parse(readFileSync(path.join(appRoot, relative), "utf8"));
const canaryIds = Object.keys(CANARY_TOOLS);

// The sweep's plan for every live Tool, with the engine and handler the current
// code assigns.
function livePlans() {
  const handlers = scanPageHandlers(path.join(appRoot, "app"));
  const fixtures = loadFixtures(path.join(appRoot, "benchmarks"));
  return read(STATUS_INPUTS.catalog)
    .filter((tool) => tool.isActive)
    .map((tool) => planTool(tool, { handlers, fixtures, timeoutMs: 1, ffmpegTimeoutMs: 1 }));
}

test("every canary is a live Tool the sweep can run, and it passes in the committed results", () => {
  const plans = new Map(livePlans().map((plan) => [plan.id, plan]));
  for (const id of canaryIds) {
    assert.ok(plans.has(id), `${id} is not a live Tool`);
    assert.equal(plans.get(id).status, undefined, `the sweep doesn't run ${id}: ${plans.get(id).reason}`);
  }
  assert.deepEqual(
    failingCanaries(read(STATUS_INPUTS.sweep).results, canaryIds),
    [],
    "a canary must pass in tool-sweep-results.json",
  );
});

test("every engine and page the sweep can run has a canary, or a reason in UNGUARDED", () => {
  const runnable = livePlans().filter((plan) => !plan.status);
  assert.deepEqual(
    uncoveredPaths(runnable, canaryIds, UNGUARDED),
    { engines: [], handlers: [] },
    "add a passing Tool for each to CANARY_TOOLS in scripts/lib/tool-canary.mjs",
  );
  const stillNeeded = uncoveredPaths(runnable, canaryIds);
  const labels = new Set([...stillNeeded.engines, ...stillNeeded.handlers]);
  for (const label of Object.keys(UNGUARDED)) {
    assert.ok(labels.has(label), `${label} has a canary now, or no runnable Tool: remove it from UNGUARDED`);
  }
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

test("an engine or page is covered only by a canary that uses it, or by a reason", () => {
  const plans = [
    { id: "mp4-to-webm", engine: "ffmpeg-wasm", handler: "ToolPageRenderer" },
    { id: "png-to-jpg", engine: "browser-raster", handler: "ToolPageRenderer" },
    { id: "csv-to-json", engine: "table-convert", handler: "TableConvertLanding" },
    { id: "compress-pdf", engine: "server-pdf-compress", handler: "ToolPageRenderer" },
  ];
  assert.deepEqual(uncoveredPaths(plans, ["mp4-to-webm"]), {
    engines: ["browser-raster", "server-pdf-compress", "table-convert"],
    handlers: ["TableConvertLanding"],
  });
  assert.deepEqual(
    uncoveredPaths(plans, ["mp4-to-webm", "png-to-jpg", "csv-to-json"], { "server-pdf-compress": "later" }),
    { engines: [], handlers: [] },
  );
});

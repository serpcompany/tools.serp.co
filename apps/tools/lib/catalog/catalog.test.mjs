import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  activeTools,
  allTools,
  availableOperations,
  getTool,
  getToolByRoute,
  toolHref,
} from "./catalog.ts";
import { OPERATION_LABELS, OPERATIONS, isToolOperation, operationsUsedBy } from "./operations.ts";

const registry = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
const inactive = registry.find((tool) => !tool.isActive);

test("OPERATIONS lists every operation once, in discovery order, each with a label", () => {
  assert.deepEqual(OPERATIONS, [
    "convert",
    "download",
    "compress",
    "combine",
    "bulk",
    "edit",
    "video-editor",
    "image-editor",
    "audio-editor",
    "view",
  ]);
  assert.deepEqual(Object.keys(OPERATION_LABELS).sort(), [...OPERATIONS].sort());
});

test("isToolOperation accepts only listed operations", () => {
  for (const operation of OPERATIONS) assert.equal(isToolOperation(operation), true);
  for (const value of ["", "Convert", "editor", "constructor", "toString", "__proto__", undefined, 1]) {
    assert.equal(isToolOperation(value), false, String(value));
  }
});

test("each *-editor operation holds only its own coming-soon placeholder Tool", () => {
  for (const operation of ["video-editor", "image-editor", "audio-editor"]) {
    assert.deepEqual(
      activeTools().filter((tool) => tool.operation === operation).map((tool) => tool.id),
      [operation],
    );
  }
});

test("activeTools is the registry's active entries in order, built once", () => {
  assert.equal(allTools().length, registry.length);
  assert.deepEqual(
    activeTools().map((tool) => tool.id),
    registry.filter((tool) => tool.isActive).map((tool) => tool.id),
  );
  assert.equal(activeTools(), activeTools());
});

test("getTool finds active Tools by id only", () => {
  assert.equal(getTool("png-to-jpg")?.route, "/png-to-jpg");
  assert.ok(inactive, "the registry has inactive entries");
  assert.equal(getTool(inactive.id), undefined);
  assert.equal(getTool("not-a-tool"), undefined);
});

test("getToolByRoute finds active Tools by public path, slashed or not", () => {
  assert.equal(getToolByRoute("/png-to-jpg")?.id, "png-to-jpg");
  assert.equal(getToolByRoute("/png-to-jpg/")?.id, "png-to-jpg");
  // png-to-png is served at /compress-png/, and /png-to-png/ redirects there.
  assert.equal(getToolByRoute("/compress-png/")?.id, "png-to-png");
  assert.equal(getToolByRoute("/png-to-png")?.id, "png-to-png");
  assert.equal(getToolByRoute(inactive.route), undefined);
});

test("toolHref is the slashed public path", () => {
  assert.equal(toolHref({ route: "/png-to-jpg" }), "/png-to-jpg/");
  assert.equal(toolHref(getTool("png-to-png")), "/compress-png/");
});

test("available operations keep OPERATIONS order and skip inactive and unknown operations", () => {
  assert.deepEqual(availableOperations(), [...OPERATIONS]);
  assert.deepEqual(
    operationsUsedBy([
      { isActive: true, operation: "view" },
      { isActive: true, operation: "convert" },
      { isActive: false, operation: "bulk" },
      { isActive: true, operation: "unknown" },
    ]),
    ["convert", "view"],
  );
});

test("the catalog is a typed cast: no validation, copying or freezing at module load", () => {
  const source = readFileSync(new URL("./catalog.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from "\.\/validate|validateCatalog|Object\.freeze|structuredClone/);
});

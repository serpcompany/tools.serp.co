import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const csvCombinerSource = readFileSync(
  new URL("../components/CsvCombiner.tsx", import.meta.url),
  "utf8",
);
const toolsRegistry = JSON.parse(
  readFileSync(new URL("./catalog/tools.json", import.meta.url), "utf8"),
);

test("csv combiner uses the updated video embed", () => {
  const tool = toolsRegistry.find((entry) => entry.id === "csv-combiner");

  assert.ok(tool);
  assert.equal(tool.content?.videoSection?.embedId, "Yoglg9pNRc8");
});

test("csv combiner uses a stacked workflow without the raw output textarea", () => {
  assert.doesNotMatch(csvCombinerSource, /lg:grid-cols-2/);
  assert.doesNotMatch(csvCombinerSource, /csv-combiner-output/);
  assert.doesNotMatch(csvCombinerSource, /Combined Output/);
  assert.match(csvCombinerSource, /Selected files/);
  assert.match(csvCombinerSource, /Combined successfully/);
  assert.match(csvCombinerSource, /Download Combined CSV/);
});

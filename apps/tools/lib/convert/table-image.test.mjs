import test from "node:test";
import assert from "node:assert/strict";

import { IMAGE_MAX_SIDE, IMAGE_SCALE, fitText, layoutTableImage } from "./table-image.ts";

// 7 px a character, 8 bold: close enough to a 14 px sans-serif.
const measure = (text, bold) => Array.from(text).length * (bold ? 8 : 7);
const maxCss = IMAGE_MAX_SIDE / IMAGE_SCALE;

function table(rows, columns = 3, cell = (row, column) => `r${row}c${column}`) {
  return {
    headers: Array.from({ length: columns }, (_, index) => `Column ${index + 1}`),
    rows: Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => cell(row, column))),
  };
}

test("a small table is drawn whole, each column as wide as its widest line", () => {
  const layout = layoutTableImage(table(2, 2), measure);
  assert.equal(layout.note, null);
  assert.deepEqual(
    layout.rows.map((row) => row.index),
    [-1, 0, 1],
  );
  assert.deepEqual(
    layout.columns.map((column) => column.width),
    [8 * 8 + 24, 8 * 8 + 24],
  );
  assert.ok(layout.width <= maxCss && layout.height <= maxCss);
});

test("10,000 rows show the rows that fit in 4096 px, and say how many", () => {
  const layout = layoutTableImage(table(10_000), measure);
  const shown = layout.rows.length - 1;
  assert.ok(shown > 50 && shown < 10_000);
  assert.equal(layout.note, `Showing the first ${shown} of 10,000 rows.`);
  assert.ok(layout.height <= maxCss, `${layout.height}`);
  assert.ok(layout.height * IMAGE_SCALE <= IMAGE_MAX_SIDE);
});

test("a wide table shows the columns that fit, and says how many", () => {
  const layout = layoutTableImage(table(3, 200, () => "x".repeat(30)), measure);
  assert.ok(layout.columns.length < 200);
  assert.equal(layout.note, `Showing the first ${layout.columns.length} of 200 columns.`);
  assert.ok(layout.width <= maxCss, `${layout.width}`);
});

test("a long cell ends in an ellipsis, and line breaks make a taller row, up to six lines", () => {
  const long = "word ".repeat(2000);
  const layout = layoutTableImage(
    { headers: ["a", "b"], rows: [[long, "one\ntwo\nthree"], ["x", "1\n2\n3\n4\n5\n6\n7\n8"]] },
    measure,
  );
  assert.equal(layout.columns[0].width, 320 + 24);
  assert.equal(layout.rows[1].height, 3 * 20 + 16);
  assert.equal(layout.rows[2].height, 6 * 20 + 16);
  assert.equal(layout.rows[2].lines[1].at(-1), "6…");
  const fitted = fitText(long, 320, measure, false);
  assert.ok(fitted.endsWith("…"));
  assert.ok(measure(fitted, false) <= 320);
  assert.equal(fitText("short", 320, measure, false), "short");
});

test("an empty table is just its header", () => {
  const layout = layoutTableImage({ headers: ["only"], rows: [] }, measure);
  assert.equal(layout.rows.length, 1);
  assert.equal(layout.note, null);
});

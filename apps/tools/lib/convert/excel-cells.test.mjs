import test from "node:test";
import assert from "node:assert/strict";

import { writeExcelCells } from "./excel-cells.ts";
import { parseExcelCells } from "./table-data.ts";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("a sheet's cells read back as the same table, whatever they hold (2,000 generated tables)", () => {
  const rng = mulberry32(266);
  // Pieces a cell can be made of: the characters the text's format uses
  // (tabs, line breaks, quotes), a byte order mark, spaces, other scripts.
  const pieces = ["a", "B", "1", " ", "\t", "\n", "\r", "\r\n", '"', '""', "﻿", ",", ";", "'", "é", "日本", "😀", ""];
  const cell = () => Array.from({ length: Math.floor(rng() * 5) }, () => pieces[Math.floor(rng() * pieces.length)]).join("");
  for (let index = 0; index < 2_000; index += 1) {
    const columns = 1 + Math.floor(rng() * 4);
    const row = () => Array.from({ length: columns }, cell);
    const table = { headers: row(), rows: Array.from({ length: Math.floor(rng() * 6) }, row) };
    // A sheet's table ends at its last value (xlsx-sheets.ts), and starts at
    // its first: a one-column sheet never ends on an empty cell.
    const last = table.rows.at(-1) ?? table.headers;
    if (last.every((value) => !value.trim())) last[0] = "x";
    const text = writeExcelCells(table);
    assert.deepEqual(parseExcelCells(text), { table, error: null }, JSON.stringify(text));
  }
});

test("cells copied from Excel: tab-separated, a quoted cell holding line breaks, a line break after the last row", () => {
  const copied = 'Region\tNote\tUnits\r\nNorth\t"two\r\nlines, ""quoted"""\t1,200\r\n\t\t\r\nSouth\tplain\t3,400\r\n';
  assert.deepEqual(parseExcelCells(copied), {
    table: {
      headers: ["Region", "Note", "Units"],
      rows: [
        ["North", 'two\r\nlines, "quoted"', "1,200"],
        ["", "", ""],
        ["South", "plain", "3,400"],
      ],
    },
    error: null,
  });
  // One column: an empty row inside it stays a row; the line break that ends
  // the last row isn't one.
  assert.deepEqual(parseExcelCells("Name\nAlpha\n\nBeta\n").table, { headers: ["Name"], rows: [["Alpha"], [""], ["Beta"]] });
  // A row shorter than the header is filled; commas don't split cells.
  assert.deepEqual(parseExcelCells("a\tb\n1,5").table, { headers: ["a", "b"], rows: [["1,5", ""]] });
  // A quote that never closes is an error, as in CSV.
  assert.match(parseExcelCells('a\tb\n"open\t1').error, /quote/i);
});

test("the text is written the way Excel copies cells", () => {
  assert.equal(
    writeExcelCells({ headers: ["Name", "Note"], rows: [["Alpha", 'say "hi"'], ["Beta", "a\tb"], ["Gamma", " spaced "]] }),
    'Name\tNote\nAlpha\t"say ""hi"""\nBeta\t"a\tb"\nGamma\t spaced ',
  );
});

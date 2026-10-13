import test from "node:test";
import assert from "node:assert/strict";

import { TABLE_CHARS, excelCellSize, readExcelCells, writeExcelCells } from "./excel-cells.ts";
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
  // A quote that never closes is the cell's text, not an error: Excel would
  // have closed it.
  assert.deepEqual(parseExcelCells('a\tb\n"open\t1').table, { headers: ["a", "b"], rows: [['"open', "1"]] });
});

test("a cell that starts with a quote is quoted only when Excel would have quoted it; otherwise it's its text (review of #299)", () => {
  // The review's case: Excel quotes a copied cell only when it must, so a
  // cell that merely starts with a quote arrives as it stands.
  assert.deepEqual(parseExcelCells('Title\tPrice\r\n"Best" seller\t5\r\n'), {
    table: { headers: ["Title", "Price"], rows: [['"Best" seller', "5"]] },
    error: null,
  });
  // Quotes inside an unquoted cell, a lone quote, a quote at the end, a
  // cell in quotes that holds nothing Excel would quote.
  assert.deepEqual(readExcelCells('say "hi"\t"\tend\t""x\t"Best"\t""'), [['say "hi"', '"', "end", '""x', '"Best"', '""']]);
  // Quoted as Excel quotes: the closing quote ends the cell, before a tab, a
  // line break or the end of the text, and the cell holds a tab, a line
  // break or a quote (doubled).
  assert.deepEqual(readExcelCells('"a"b\t"c""d"\r\n"e\tf"\t"g\r\nh"\n"""q"""'), [
    ['"a"b', 'c"d'],
    ["e\tf", "g\r\nh"],
    ['"q"'],
  ]);
  // A quote that opens a cell and closes in a later one, with text after it,
  // isn't a quoted cell: each cell is its own text.
  assert.deepEqual(readExcelCells('"one\ttwo" three\tfour'), [['"one', 'two" three', "four"]]);
  // Empty cells, a byte order mark before the first, Excel's \r\n, a lone \r.
  assert.deepEqual(readExcelCells("\uFEFFa\t\tc\r\n\t\t\rx\t\t"), [["a", "", "c"], ["", "", ""], ["x", "", ""]]);
  assert.deepEqual(readExcelCells(""), [[""]]);
});

test("empty rows at the end aren't rows, however many columns: a selection copied past the last value adds them", () => {
  const copied = 'a\t\tc\r\n\t\t\r\n1\t"x\ty"\t\r\n\t\t\r\n\t\t\r\n';
  assert.deepEqual(parseExcelCells(copied).table, { headers: ["a", "", "c"], rows: [["", "", ""], ["1", "x\ty", ""]] });
  assert.deepEqual(parseExcelCells("Name\r\nAlpha\r\n\r\n\r\n").table, { headers: ["Name"], rows: [["Alpha"]] });
  // A row of spaces is a value, and stays.
  assert.deepEqual(parseExcelCells("a\tb\n \t\n").table, { headers: ["a", "b"], rows: [[" ", ""]] });
  assert.match(parseExcelCells("\t\r\n\t\r\n").error, /no cells/);
});

test("cells as Excel copies them, quoted only where they hold a tab or a line break, read back as the same table (2,000 generated tables)", () => {
  const rng = mulberry32(299);
  // No byte order mark: Excel's clipboard text has none.
  const pieces = ["a", "B", "1", " ", "\t", "\n", "\r\n", '"', '""', ",", "é", "日本", ""];
  const quoted = (value) => /[\t\n\r]/.test(value);
  // An unquoted cell that starts with a quote closes it, as `"Best" seller`
  // or `"Best"` do; a ditto mark `"` or `"x` can read as the start of a
  // quoted cell (the next test).
  const closes = /^"[^"]*"(?!")/;
  const cell = () => {
    for (;;) {
      const value = Array.from({ length: Math.floor(rng() * 5) }, () => pieces[Math.floor(rng() * pieces.length)]).join("");
      if (quoted(value) || !value.startsWith('"') || closes.test(value)) return value;
    }
  };
  const copy = (value) => (quoted(value) ? `"${value.replaceAll('"', '""')}"` : value);
  let startsWithQuote = 0;
  for (let index = 0; index < 2_000; index += 1) {
    const columns = 1 + Math.floor(rng() * 4);
    const row = () => Array.from({ length: columns }, cell);
    const table = { headers: row(), rows: Array.from({ length: Math.floor(rng() * 6) }, row) };
    const last = table.rows.at(-1) ?? table.headers;
    if (last.every((value) => !value.trim())) last[0] = "x";
    const all = [table.headers, ...table.rows];
    if (all.some((cells) => cells.some((value) => !quoted(value) && value.startsWith('"')))) startsWithQuote += 1;
    const text = `${all.map((cells) => cells.map(copy).join("\t")).join("\r\n")}\r\n`;
    assert.deepEqual(parseExcelCells(text), { table, error: null }, JSON.stringify(text));
  }
  assert.ok(startsWithQuote >= 200, `${startsWithQuote} tables with an unquoted cell starting with a quote`);
});

test("a ditto mark and a cell ending in a quote copy as a quoted cell would: the reading that keeps the rows as wide is taken", () => {
  // `"` then `14"`: read as one quoted cell, the row would be one cell wide.
  assert.deepEqual(parseExcelCells('Pipe\tSize\r\nCopper\t12"\r\n"\t14"\r\n').table, {
    headers: ["Pipe", "Size"],
    rows: [["Copper", '12"'], ['"', '14"']],
  });
  // With a cell that holds a line break too, no reading of every cell as it
  // stands keeps the rows as wide either: the text reads as Excel would
  // write a quoted cell. Excel's copy can't tell these apart.
  assert.deepEqual(readExcelCells('Pipe\tNote\r\n"\t14"\r\nCopper\t"two\nlines"\r\n'), [["Pipe", "Note"], ["\t14"], ["Copper", "two\nlines"]]);
});

test("a cell's size is its length as written, quotes counted", () => {
  for (const value of ["", "plain", 'say "hi"', "a\tb", "two\nlines", '"', "\uFEFF", "日本"]) {
    assert.equal(excelCellSize(value), writeExcelCells({ headers: [value], rows: [] }).length, JSON.stringify(value));
  }
  assert.ok(TABLE_CHARS >= 1_000_000);
});

test("the text is written the way Excel copies cells", () => {
  assert.equal(
    writeExcelCells({ headers: ["Name", "Note"], rows: [["Alpha", 'say "hi"'], ["Beta", "a\tb"], ["Gamma", " spaced "]] }),
    'Name\tNote\nAlpha\t"say ""hi"""\nBeta\t"a\tb"\nGamma\t spaced ',
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import { TABLE_CHARS, excelCellSize, readExcelCells, readPastedCells, writeExcelCells } from "./excel-cells.ts";
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

test("text the page wrote reads back as the same table, whatever its cells hold (2,000 generated tables)", () => {
  const rng = mulberry32(266);
  // Pieces a cell can be made of: the characters the text's format uses
  // (tabs, line breaks, quotes), a byte order mark, spaces, other scripts.
  const pieces = ["a", "B", "1", " ", "\t", "\n", "\r", "\r\n", '"', '""', "﻿", ",", ";", "'", "é", "日本", "😀", ""];
  const cell = () => Array.from({ length: Math.floor(rng() * 5) }, () => pieces[Math.floor(rng() * pieces.length)]).join("");
  for (let index = 0; index < 2_000; index += 1) {
    const columns = 1 + Math.floor(rng() * 4);
    const row = () => Array.from({ length: columns }, cell);
    const table = { headers: row(), rows: Array.from({ length: Math.floor(rng() * 6) }, row) };
    // An empty last row stays (one added in the grid, #299 review), but in
    // one column it's an empty last line, which the format can't tell from
    // the line break that ends the text (nor can a CSV).
    const last = table.rows.at(-1) ?? table.headers;
    if (columns === 1 && !last[0]) last[0] = "x";
    const text = writeExcelCells(table);
    assert.deepEqual(parseExcelCells(text, true), { table, error: null }, JSON.stringify(text));
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
  assert.deepEqual(readExcelCells('say "hi"\t"\tend\t""x\t"Best"\t""', false), [['say "hi"', '"', "end", '""x', '"Best"', '""']]);
  // Quoted as Excel quotes: the closing quote ends the cell, before a tab, a
  // line break or the end of the text, and the cell holds a tab, a line
  // break or a quote (doubled).
  assert.deepEqual(readExcelCells('"a"b\t"c""d"\r\n"e\tf"\t"g\r\nh"\n"""q"""\tz', false), [
    ['"a"b', 'c"d'],
    ["e\tf", "g\r\nh"],
    ['"q"', "z"],
  ]);
  // Rows typed of different widths: no reading makes them one width, so no
  // rows are merged.
  assert.deepEqual(readExcelCells('a\tb\n"x\ny"\tc\td', false), [["a", "b"], ['"x'], ['y"', "c", "d"]]);
  // A quote that opens a cell and closes in a later one, with text after it,
  // isn't a quoted cell: each cell is its own text.
  assert.deepEqual(readExcelCells('"one\ttwo" three\tfour', false), [['"one', 'two" three', "four"]]);
  // Empty cells, a byte order mark before the first, Excel's \r\n, a lone \r.
  assert.deepEqual(readExcelCells("\uFEFFa\t\tc\r\n\t\t\rx\t\t", false), [["a", "", "c"], ["", "", ""], ["x", "", ""]]);
  assert.deepEqual(readExcelCells("", false), [[""]]);
});

test("empty rows at the end aren't rows, however many columns: a selection copied past the last value adds them", () => {
  const copied = 'a\t\tc\r\n\t\t\r\n1\t"x\ty"\t\r\n\t\t\r\n\t\t\r\n';
  assert.deepEqual(parseExcelCells(copied).table, { headers: ["a", "", "c"], rows: [["", "", ""], ["1", "x\ty", ""]] });
  assert.deepEqual(parseExcelCells("Name\r\nAlpha\r\n\r\n\r\n").table, { headers: ["Name"], rows: [["Alpha"]] });
  // A row of spaces is a value, and stays.
  assert.deepEqual(parseExcelCells("a\tb\n \t\n").table, { headers: ["a", "b"], rows: [[" ", ""]] });
  assert.match(parseExcelCells("\t\r\n\t\r\n").error, /no cells/);
});

// Cells as Excel copies them: a cell in quotes, its quotes doubled, only
// when it holds a tab or a line break, and a line break after the last row.
// With the copy's HTML table, as the clipboard has it: each row's cells,
// which cells hold a tab or a line break, and which start with a quote.
const QUOTED = /[\t\n\r]/;
const copy = (value) => (QUOTED.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const excelCopy = (rows) => `${rows.map((cells) => cells.map(copy).join("\t")).join("\r\n")}\r\n`;
function copiedShape(rows) {
  const keys = (test) => new Set(rows.flatMap((cells, row) => cells.flatMap((value, column) => (test(value) ? [`${row}:${column}`] : []))));
  return { widths: rows.map((cells) => cells.length), quoted: keys((value) => QUOTED.test(value)), quoteFirst: keys((value) => value.trimStart().startsWith('"')) };
}
// A cell Excel leaves as it stands that reads as one quoted for a doubled
// quote: `"x""y"`, `""""`.
const quotedForQuotes = /^"(?:[^"]|"")*""(?:[^"]|"")*"$/;

test("cells copied with Excel's HTML table read back exactly, whatever they hold: ditto marks, quotes, tabs, line breaks (2,000 generated tables)", () => {
  const rng = mulberry32(299);
  const pieces = ["a", "B", "1", " ", "\t", "\n", "\r\n", '"', '""', ",", "é", "日本", ""];
  const cell = () => {
    for (;;) {
      const value = Array.from({ length: Math.floor(rng() * 5) }, () => pieces[Math.floor(rng() * pieces.length)]).join("");
      // Text Excel leaves as it stands that reads as a quoted cell whose
      // value starts with a quote (`""""`, `"""x"`), the way a spreadsheet
      // that quotes a cell for its quotes writes `"x`: read as that.
      if (QUOTED.test(value) || !/^"""(?:[^"]|"")*"$/.test(value)) return value;
    }
  };
  let ambiguous = 0;
  for (let index = 0; index < 2_000; index += 1) {
    const columns = 1 + Math.floor(rng() * 4);
    const rows = Array.from({ length: 1 + Math.floor(rng() * 6) }, () => Array.from({ length: columns }, cell));
    const text = excelCopy(rows);
    if (JSON.stringify(readExcelCells(text, false)) !== JSON.stringify(rows)) ambiguous += 1;
    assert.deepEqual(readPastedCells(text, copiedShape(rows)), rows, JSON.stringify(text));
  }
  // Many of them read differently without the HTML: the text alone can't
  // say which reading Excel meant.
  assert.ok(ambiguous >= 200, `${ambiguous} tables the text alone reads differently`);
});

test("cells copied without the HTML: rows are never merged on a quote, wherever quotes are (2,000 generated tables)", () => {
  const rng = mulberry32(2992);
  // No tabs or line breaks in a cell; ditto marks, quotes at either end,
  // unclosed quotes.
  const pieces = ["a", "B", "1", " ", '"', '"', '""', "14", ",", "é", ""];
  const cell = () => {
    for (;;) {
      const value = Array.from({ length: Math.floor(rng() * 4) }, () => pieces[Math.floor(rng() * pieces.length)]).join("");
      if (!quotedForQuotes.test(value)) return value;
    }
  };
  let dittos = 0;
  for (let index = 0; index < 2_000; index += 1) {
    const columns = 1 + Math.floor(rng() * 4);
    const header = Array.from({ length: columns }, (_, column) => `Column ${column + 1}`);
    const rows = [header, ...Array.from({ length: Math.floor(rng() * 8) }, () => Array.from({ length: columns }, cell))];
    if (rows.flat().filter((value) => value === '"').length >= 2) dittos += 1;
    const text = excelCopy(rows);
    assert.deepEqual(readExcelCells(text, false), rows, JSON.stringify(text));
  }
  assert.ok(dittos >= 200, `${dittos} tables with two or more ditto marks`);
});

test("cells copied without the HTML: a cell holding line breaks is one cell, and ditto marks around it stay in their rows (2,000 generated tables)", () => {
  const rng = mulberry32(2993);
  // A cell is a value of one line, with quotes anywhere (ditto marks, inch
  // values, quoted words), or text over two or more lines, with quotes
  // inside its words.
  const oneLine = ["a", "B", "1", " ", '"', '"', '""', "14", "é", ""];
  const words = ["word", "Main St", 'say "hi"', '12" pipe', "é", "1"];
  const breaks = ["\n", "\r\n", "\n\n"];
  const pick = (pieces) => pieces[Math.floor(rng() * pieces.length)];
  const cell = () => {
    if (rng() < 0.25) {
      return Array.from({ length: 2 + Math.floor(rng() * 3) }, () => pick(words)).reduce((text, word) => text + pick(breaks) + word);
    }
    for (;;) {
      const value = Array.from({ length: Math.floor(rng() * 4) }, () => pick(oneLine)).join("");
      if (!quotedForQuotes.test(value)) return value;
    }
  };
  let multiLine = 0;
  for (let index = 0; index < 2_000; index += 1) {
    // Two or more columns: in one, a line break inside a cell and a ditto
    // mark under a ditto mark copy alike (the HTML tells them apart).
    const columns = 2 + Math.floor(rng() * 3);
    const header = Array.from({ length: columns }, (_, column) => `Column ${column + 1}`);
    const rows = [header, ...Array.from({ length: 1 + Math.floor(rng() * 8) }, () => Array.from({ length: columns }, cell))];
    if (rows.flat().some((value) => QUOTED.test(value))) multiLine += 1;
    const text = excelCopy(rows);
    assert.deepEqual(readExcelCells(text, false), rows, JSON.stringify(text));
  }
  assert.ok(multiLine >= 1_000, `${multiLine} tables with a cell holding a line break`);
});

test("the review's ditto marks: with or without the HTML, every row stays a row", () => {
  const cases = [
    // Two ditto marks in a column.
    [["Item", "Color"], ["Shirt", "Red"], ["Pants", '"'], ["Hat", '"'], ["Sock", "Blue"]],
    // A ditto mark above a later inch value.
    [["Size", "Item"], ['12"', "Pipe"], ['"', "Valve"], ['14"', "Cap"]],
    // A ditto mark and an inch value in one row, and a cell that holds a
    // line break below them.
    [["Pipe", "Note"], ['"', '14"'], ["Copper", "two\nlines"]],
    // A cell holding a line break above two ditto marks.
    [["Item", "Note"], ["Shirt", "line1\nline2"], ["Pants", '"'], ["Hat", '"']],
  ];
  for (const rows of cases) {
    const text = excelCopy(rows);
    assert.deepEqual(readExcelCells(text, false), rows, JSON.stringify(text));
    assert.deepEqual(readPastedCells(text, copiedShape(rows)), rows, JSON.stringify(text));
  }
  // One column: a cell holding line breaks copies as ditto marks around a
  // value would. Without the HTML the rows stay rows; with it, it's one cell.
  const column = [["Address"], ["1 Main St\nSpringfield"], ["2 Oak Ave"]];
  const text = excelCopy(column);
  assert.deepEqual(readExcelCells(text, false), [["Address"], ['"1 Main St'], ['Springfield"'], ["2 Oak Ave"]]);
  assert.deepEqual(readPastedCells(text, copiedShape(column)), column);
  // A shape the text can't have: no reading is taken.
  assert.equal(readPastedCells(text, { widths: [1, 1], quoted: new Set(), quoteFirst: new Set() }), null);
});

test("1,000,000 pasted rows with a ditto mark in the first column stay 1,000,000 rows, read quickly", () => {
  const text = `Mark\tItem\r\n${'"\tx\r\n'.repeat(1_000_000)}`;
  const started = performance.now();
  const { table } = parseExcelCells(text);
  const elapsed = performance.now() - started;
  assert.equal(table.rows.length, 1_000_000);
  assert.deepEqual([table.rows[0], table.rows.at(-1)], [['"', "x"], ['"', "x"]]);
  assert.ok(elapsed < 3_000, `${Math.round(elapsed)} ms`);
  // With a cell holding a line break as well, each quote is read alone.
  const mixed = `Mark\tItem\r\nx\t"two\nlines"\r\n${'"\tx\r\n'.repeat(1_000_000)}`;
  const timed = performance.now();
  const rows = readExcelCells(mixed, false);
  assert.equal(rows.length, 1_000_002);
  assert.deepEqual(rows.slice(0, 3), [["Mark", "Item"], ["x", "two\nlines"], ['"', "x"]]);
  assert.ok(performance.now() - timed < 3_000, `${Math.round(performance.now() - timed)} ms`);
});

test("text the page wrote keeps an empty last row; pasted text doesn't (#299 review)", () => {
  const table = { headers: ["a", "b"], rows: [["1", "2"], ["", ""]] };
  assert.deepEqual(parseExcelCells(writeExcelCells(table), true).table, table);
  assert.deepEqual(parseExcelCells("a\tb\r\n1\t2\r\n\t\r\n").table, { headers: ["a", "b"], rows: [["1", "2"]] });
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

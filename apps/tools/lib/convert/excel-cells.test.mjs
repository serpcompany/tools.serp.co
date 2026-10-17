import test from "node:test";
import assert from "node:assert/strict";

import { TABLE_CHARS, excelCellSize, readExcelCells, readPastedCells, writeExcelCells } from "./excel-cells.ts";
import { parseExcelCells } from "./table-data.ts";
import { threadCpuMs } from "./test-cpu-time.mjs";

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

test("text the page wrote reads back exactly as written, whatever its cells hold (2,000 generated tables)", () => {
  const rng = mulberry32(266);
  // Pieces a cell can be made of: the characters the text's format uses
  // (tabs, line breaks, quotes), a byte order mark, spaces, other scripts,
  // and what a visitor puts in the grid: ditto marks and inch values, and
  // quotes around a tab or a line break, which a ditto mark's quote could
  // close in a reading of typed text (#299 review round 4).
  const pieces = ["a", "B", "1", " ", "\t", "\n", "\r", "\r\n", '"', '""', "﻿", ",", ";", "'", "é", "日本", "😀", "", '"\t"', '"\n"', '14"'];
  const cell = () => Array.from({ length: Math.floor(rng() * 5) }, () => pieces[Math.floor(rng() * pieces.length)]).join("");
  for (let index = 0; index < 2_000; index += 1) {
    const columns = 1 + Math.floor(rng() * 4);
    const row = () => Array.from({ length: columns }, cell);
    const table = { headers: row(), rows: Array.from({ length: Math.floor(rng() * 6) }, row) };
    // An empty last row stays (one added in the grid, #299 review), but in
    // one column it's a blank last line, which isn't a row, as in a CSV.
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
  assert.deepEqual(readExcelCells('say "hi"\t"\tend\t""x\t"Best"\t""'), [['say "hi"', '"', "end", '""x', '"Best"', '""']]);
  // Quoted as Excel quotes: the closing quote ends the cell, before a tab, a
  // line break or the end of the text, and the cell holds a tab, a line
  // break or a quote (doubled).
  assert.deepEqual(readExcelCells('"a"b\t"c""d"\r\n"e\tf"\t"g\r\nh"\n"""q"""\tz'), [
    ['"a"b', 'c"d'],
    ["e\tf", "g\r\nh"],
    ['"q"', "z"],
  ]);
  // Rows typed of different widths: no reading makes them one width, so no
  // rows are merged.
  assert.deepEqual(readExcelCells('a\tb\n"x\ny"\tc\td'), [["a", "b"], ['"x'], ['y"', "c", "d"]]);
  // A quote that opens a cell and closes in a later one, with text after it,
  // isn't a quoted cell: each cell is its own text.
  assert.deepEqual(readExcelCells('"one\ttwo" three\tfour'), [['"one', 'two" three', "four"]]);
  // Empty cells, a byte order mark before the first, Excel's \r\n, a lone \r.
  assert.deepEqual(readExcelCells("\uFEFFa\t\tc\r\n\t\t\rx\t\t"), [["a", "", "c"], ["", "", ""], ["x", "", ""]]);
  assert.deepEqual(readExcelCells(""), [[""]]);
});

test("blank lines at the end aren't rows, as in a CSV input; rows of empty cells are (#299 review)", () => {
  // Enter pressed twice or three times after the last row adds nothing.
  for (const end of ["\n", "\n\n", "\n\n\n", "\r\n\r\n"]) {
    assert.deepEqual(parseExcelCells(`Item\tColor\nShirt\tRed${end}`).table, { headers: ["Item", "Color"], rows: [["Shirt", "Red"]] });
  }
  assert.deepEqual(parseExcelCells("Name\r\nAlpha\r\n\r\n\r\n").table, { headers: ["Name"], rows: [["Alpha"]] });
  // A row of empty cells is a row, as `,,` is in a CSV: the one the grid
  // adds, blank lines typed after it or not, and a selection copied past
  // the last value.
  const grid = writeExcelCells({ headers: ["Item", "Color"], rows: [["Shirt", "Red"], ["", ""]] });
  assert.equal(grid, "Item\tColor\nShirt\tRed\n\t");
  for (const text of [grid, `${grid}\n\n`]) {
    assert.deepEqual(parseExcelCells(text).table, { headers: ["Item", "Color"], rows: [["Shirt", "Red"], ["", ""]] });
  }
  const copied = 'a\t\tc\r\n\t\t\r\n1\t"x\ty"\t\r\n\t\t\r\n';
  assert.deepEqual(parseExcelCells(copied).table, { headers: ["a", "", "c"], rows: [["", "", ""], ["1", "x\ty", ""], ["", "", ""]] });
  // A row of spaces is a value, and stays; a blank line between rows is a row.
  assert.deepEqual(parseExcelCells("a\tb\n \t\n").table, { headers: ["a", "b"], rows: [[" ", ""]] });
  assert.match(parseExcelCells("\r\n\r\n").error, /no cells/);
  // Blank lines typed after the last row don't change how the rows read: a
  // ditto mark and an inch value in one row stay two cells.
  assert.deepEqual(parseExcelCells('Size\tItem\n"\t14"\n\n\n').table.rows, [['"', '14"']]);
});

// Cells as Excel copies them: a cell in quotes, its quotes doubled, only
// when it holds a tab or a line break, and a line break after the last row.
// With the copy's HTML table, as the clipboard has it: each row's cells,
// which cells hold a tab or a line break, and the text of each that starts
// with a quote.
const QUOTED = /[\t\n\r]/;
const copy = (value) => (QUOTED.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const excelCopy = (rows) => `${rows.map((cells) => cells.map(copy).join("\t")).join("\r\n")}\r\n`;
function copiedShape(rows) {
  const cells = (test) => rows.flatMap((values, row) => values.flatMap((value, column) => (test(value) ? [[`${row}:${column}`, value]] : [])));
  return {
    widths: rows.map((values) => values.length),
    quoted: new Set(cells((value) => QUOTED.test(value)).map(([key]) => key)),
    quoteFirst: new Map(cells((value) => value.trimStart().startsWith('"'))),
  };
}
// A cell Excel leaves as it stands that reads as one quoted for a doubled
// quote: `"x""y"`, `""""`.
const quotedForQuotes = /^"(?:[^"]|"")*""(?:[^"]|"")*"$/;

test("cells copied with Excel's HTML table read back exactly, whatever they hold: ditto marks, quotes, tabs, line breaks (2,000 generated tables)", () => {
  const rng = mulberry32(299);
  // `""""` and `"""Doc"""` too, which read as quoted cells for their quotes
  // without the table's text for them (#299 review).
  const pieces = ["a", "B", "1", " ", "\t", "\n", "\r\n", '"', '""', '"""', ",", "é", "日本", ""];
  const cell = () => Array.from({ length: Math.floor(rng() * 5) }, () => pieces[Math.floor(rng() * pieces.length)]).join("");
  let ambiguous = 0;
  for (let index = 0; index < 2_000; index += 1) {
    const columns = 1 + Math.floor(rng() * 4);
    const rows = Array.from({ length: 1 + Math.floor(rng() * 6) }, () => Array.from({ length: columns }, cell));
    const text = excelCopy(rows);
    if (JSON.stringify(readExcelCells(text)) !== JSON.stringify(rows)) ambiguous += 1;
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
    // In one column an empty last cell is a blank last line, which isn't a row.
    if (columns === 1 && rows.length > 1 && !rows.at(-1)[0]) rows.at(-1)[0] = "x";
    if (rows.flat().filter((value) => value === '"').length >= 2) dittos += 1;
    const text = excelCopy(rows);
    assert.deepEqual(readExcelCells(text), rows, JSON.stringify(text));
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
    assert.deepEqual(readExcelCells(text), rows, JSON.stringify(text));
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
    assert.deepEqual(readExcelCells(text), rows, JSON.stringify(text));
    assert.deepEqual(readPastedCells(text, copiedShape(rows)), rows, JSON.stringify(text));
  }
  // One column: a cell holding line breaks copies as ditto marks around a
  // value would. Without the HTML the rows stay rows; with it, it's one cell.
  const column = [["Address"], ["1 Main St\nSpringfield"], ["2 Oak Ave"]];
  const text = excelCopy(column);
  assert.deepEqual(readExcelCells(text), [["Address"], ['"1 Main St'], ['Springfield"'], ["2 Oak Ave"]]);
  assert.deepEqual(readPastedCells(text, copiedShape(column)), column);
  // A shape the text can't have: no reading is taken.
  assert.equal(readPastedCells(text, { widths: [1, 1], quoted: new Set(), quoteFirst: new Set() }), null);
});

test("1,000,000 pasted rows with a ditto mark in the first column stay 1,000,000 rows, in time linear in the rows", () => {
  // Time grows with the rows, not their square: ten times the rows take far
  // less than a hundred times as long. The ceiling is only a backstop for a
  // slow machine (#299 CI).
  const dittos = (rows) => `Mark\tItem\r\n${'"\tx\r\n'.repeat(rows)}`;
  // With a cell holding a line break as well, each quote is read alone, by
  // the search for the fewest merged lines.
  const mixed = (rows) => `Mark\tItem\r\nx\t"two\nlines"\r\n${'"\tx\r\n'.repeat(rows)}`;
  const timed = (text) => {
    const started = threadCpuMs();
    const rows = readExcelCells(text);
    return { rows, ms: threadCpuMs() - started };
  };
  for (const [name, make, head] of [
    ["ditto marks", dittos, [["Mark", "Item"], ['"', "x"]]],
    ["ditto marks and a two-line cell", mixed, [["Mark", "Item"], ["x", "two\nlines"], ['"', "x"]]],
  ]) {
    // The smaller read three times, its fastest kept, so a pause in one
    // doesn't make the larger look slow.
    const small = Math.min(...[0, 1, 2].map(() => timed(make(100_000)).ms));
    const large = timed(make(1_000_000));
    assert.equal(large.rows.length, head.length - 1 + 1_000_000, name);
    assert.deepEqual(large.rows.slice(0, head.length), head, name);
    assert.deepEqual(large.rows.at(-1), ['"', "x"], name);
    assert.ok(large.ms / small < 30, `${name}: 1,000,000 rows took ${Math.round(large.ms)} ms, 100,000 took ${Math.round(small)} ms`);
    assert.ok(large.ms < 20_000, `${name}: ${Math.round(large.ms)} ms`);
  }
  assert.equal(parseExcelCells(dittos(1_000_000)).table.rows.length, 1_000_000);
});

test("Excel's HTML table gives a cell copied as it stands its text: `\"\"\"\"` and `\"\"\"Doc\"\"\"` aren't read as quoted (#299 review)", () => {
  const rows = [["Code", "Note"], ['""""', "empty string"], ['"""Doc"""', "docstring"], ['"x""y"', "pair"]];
  const text = excelCopy(rows);
  assert.equal(text, 'Code\tNote\r\n""""\tempty string\r\n"""Doc"""\tdocstring\r\n"x""y"\tpair\r\n');
  assert.deepEqual(readPastedCells(text, copiedShape(rows)), rows);
  // Without the table's text, they read as quoted for their quotes.
  assert.deepEqual(readExcelCells(text).slice(1), [['"', "empty string"], ['"Doc"', "docstring"], ['x"y', "pair"]]);
  // A spreadsheet that quotes a cell for its quotes: the table's text is the
  // quoted value, spaces aside, as HTML shows them.
  const quoting = 'Code\r\n"say ""hi""  there"\r\n';
  const shape = { widths: [1, 1], quoted: new Set(), quoteFirst: new Map([["1:0", ' say "hi" there']]) };
  assert.deepEqual(readPastedCells(quoting, shape), [["Code"], ['say "hi"  there']]);
});

test("the review's ditto marks, put in a sheet's cells in the grid, read exactly as the page writes them (#299 review rounds 3 and 4)", () => {
  const reads = (table) => assert.deepEqual(parseExcelCells(writeExcelCells(table), true).table, table, JSON.stringify(writeExcelCells(table)));
  // Round 4: a ditto mark before a note that opens with a line break and
  // holds a tab.
  const note = { headers: ["Item", "Note"], rows: [['"', "\nfoo\tbar"], ["y", "z"]] };
  assert.equal(writeExcelCells(note), 'Item\tNote\n""""\t"\nfoo\tbar"\ny\tz');
  reads(note);
  // Round 4: a cell holding only a line break, ditto marks below it, and two
  // full rows of them.
  reads({ headers: ["A", "B"], rows: [["p", "\n"], ["q", '"'], ['"', "s"]] });
  reads({ headers: ["A", "B"], rows: [["p", "\n"], ['"', '"'], ['"', '"']] });
  // Round 3: ditto marks in a column, a ditto mark above an inch value, and
  // the limit round 3 named: in one column, a cell holding only a line break
  // above two ditto marks.
  reads({ headers: ["Item", "Color"], rows: [["Shirt", "Red"], ["Pants", '"'], ["Hat", '"'], ["Sock", "Blue"]] });
  reads({ headers: ["Size", "Item"], rows: [['12"', "Pipe"], ['"', "Valve"], ['14"', "Cap"]] });
  reads({ headers: ["Item"], rows: [["\n"], ['"'], ['"']] });
});

test("the same edit typed into the page's text can't be read back: why a sheet's text is read-only (#299, the owner's decision)", () => {
  // Round 4's first case typed: the visitor's reading can't know that the
  // note was one cell, as its lines are rows as wide as the table. The page
  // refuses typing in a sheet's text (output-state.ts), so this text only
  // arises from typing the whole of it.
  const sheet = writeExcelCells({ headers: ["Item", "Note"], rows: [["x", "\nfoo\tbar"], ["y", "z"]] });
  const typed = sheet.replace("x\t", '"\t');
  assert.deepEqual(readExcelCells(typed), [["Item", "Note"], ['"', '"'], ["foo", 'bar"'], ["y", "z"]]);
  // Nor can a reading of the page's: its quotes now open a cell holding a
  // tab, and the note's lines are rows.
  assert.deepEqual(readExcelCells(typed, true), [["Item", "Note"], ["\t"], ["foo", 'bar"'], ["y", "z"]]);
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

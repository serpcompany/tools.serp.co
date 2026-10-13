// A table as the text Excel puts on the clipboard when cells are copied
// (issue #266): tab-separated, a row a line, and a cell in quotes, its quotes
// doubled, when it holds a tab or a line break, as Excel quotes; and here
// also when it holds a quote or a byte order mark, so a sheet's text reads
// back only one way (readExcelCells).
// The table converters' Excel input holds a sheet as this text, so a sheet
// read from a workbook and cells pasted from Excel are one input, and
// parseExcelCells (table-data.ts) reads it back as the same table.
//
// No imports but a type: xlsx.worker.ts writes a sheet's text with this, and
// shouldn't load a CSV parser to do it.

import type { TableData } from "./table-data.ts";

// What a table converter reads from one workbook, at most, all its sheets
// together (readWorkbookSheets' `table` in xlsx-sheets.ts): TABLE_CELLS
// cells, empty ones included, and TABLE_CHARS characters of text, which is
// the sheets' text as written here, tabs, line breaks and quotes counted. A
// sheet that would take either past it, or that has a cell longer than Excel
// allows, is left out and named, so the text the worker sends and the page
// parses is bounded however long the workbook's strings are (a few KB of
// ZIP can repeat one 100 KB string in every cell). Measured in Chromium: a
// million cells of short numbers are 6.9 million characters and show in
// about 5 seconds; 9.6 million characters in 9,500 long cells, in 1.
export const TABLE_CELLS = 1_000_000;
export const TABLE_CHARS = 10_000_000;
// The most characters a cell holds in Excel. A longer one isn't from a
// workbook Excel saved, and its sheet isn't returned (xlsx-sheets.ts).
export const MAX_CELL_CHARS = 32_767;

const NEEDS_QUOTES = /[\t\n\r"\uFEFF]/;

const cellText = (cell: string) => (NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

export function writeExcelCells(table: TableData): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map(cellText).join("\t"));
  return lines.join("\n");
}

// A cell's length as writeExcelCells writes it, without writing it.
export function excelCellSize(cell: string): number {
  if (!NEEDS_QUOTES.test(cell)) return cell.length;
  let quotes = 0;
  for (let index = cell.indexOf('"'); index >= 0; index = cell.indexOf('"', index + 1)) quotes += 1;
  return cell.length + quotes + 2;
}

const TAB = 9;
const LF = 10;
const CR = 13;
const QUOTE = 34;

// What makes a cell quoted when it's copied: a tab, a line break, a quote
// (doubled inside the quotes) or a byte order mark.
const QUOTED_FOR = /[\t\n\r\uFEFF]/;

// A cell that starts with a quote is a quoted cell only when it is one as
// Excel writes it: its closing quote (one not doubled) ends the cell, before
// a tab, a line break or the end of the text, and it holds something that
// needed quoting. Its text, quotes undoubled, and where it ends; or null,
// and the cell is its text as it stands.
function quotedCell(text: string, start: number): { value: string; end: number } | null {
  let doubled = false;
  for (let at = start + 1; ; ) {
    const quote = text.indexOf('"', at);
    if (quote < 0) return null;
    if (text.charCodeAt(quote + 1) === QUOTE) {
      doubled = true;
      at = quote + 2;
      continue;
    }
    const after = text.charCodeAt(quote + 1);
    if (quote + 1 < text.length && after !== TAB && after !== LF && after !== CR) return null;
    const inside = text.slice(start + 1, quote);
    if (!doubled && !QUOTED_FOR.test(inside)) return null;
    return { value: doubled ? inside.replaceAll('""', '"') : inside, end: quote + 1 };
  }
}

// Cells as Excel puts them on the clipboard, or as writeExcelCells writes
// them, as rows of cells. Excel quotes a copied cell only when it holds a
// tab or a line break, so a cell that starts with a quote but isn't quoted
// the way Excel quotes (`"Best" seller`, `"Best"`, a ditto mark) is that
// text, quotes and all: no text is malformed. The line break after the last
// row isn't a row, and a byte order mark before the first cell isn't text.
//
// Text can read both ways: a ditto mark `"` and, later in the row, `14"`
// copy as `"<tab>14"`, as one quoted cell holding a tab would. Cells copied
// from Excel are a rectangle, every row as wide, so the reading that keeps
// them one is taken: the quoted one, else the one with every cell as it
// stands, else (text not copied from a sheet) the quoted one.
export function readExcelCells(text: string): string[][] {
  const read = splitCells(text, true);
  if (rectangular(read)) return read;
  const literal = splitCells(text, false);
  return rectangular(literal) ? literal : read;
}

const rectangular = (rows: string[][]) => rows.every((row) => row.length === rows[0]!.length);

function splitCells(text: string, quotes: boolean): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    const quoted = quotes && text.charCodeAt(at) === QUOTE ? quotedCell(text, at) : null;
    let end = quoted?.end ?? at;
    if (!quoted) {
      for (let code = text.charCodeAt(end); end < text.length && code !== TAB && code !== LF && code !== CR; ) {
        end += 1;
        code = text.charCodeAt(end);
      }
    }
    row.push(quoted ? quoted.value : text.slice(at, end));
    if (end >= text.length) break;
    const code = text.charCodeAt(end);
    at = end + 1;
    if (code === TAB) continue;
    if (code === CR && text.charCodeAt(at) === LF) at += 1;
    rows.push(row);
    row = [];
    if (at >= text.length) return rows;
  }
  rows.push(row);
  return rows;
}

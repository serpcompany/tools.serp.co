// A table as the text Excel puts on the clipboard when cells are copied
// (issue #266): tab-separated, a row a line, and a cell in quotes, its quotes
// doubled, when it holds a tab, a line break, a quote or a byte order mark.
// The table converters' Excel input holds a sheet as this text, so a sheet
// read from a workbook and cells pasted from Excel are one input, and
// parseExcelCells (table-data.ts) reads it back as the same table.
//
// No imports but a type: xlsx.worker.ts writes a sheet's text with this, and
// shouldn't load a CSV parser to do it.

import type { TableData } from "./table-data.ts";

// The cells, empty ones included, a table converter keeps from one
// workbook: each kept sheet's rows times its columns (readWorkbookSheets'
// `cells` in xlsx-sheets.ts). A sheet that would take the total past it is
// left out and named, so the tab holds a bounded table: a million cells
// read in about a second and make about 7 MB of text.
export const TABLE_CELLS = 1_000_000;

const NEEDS_QUOTES = /[\t\n\r"\uFEFF]/;

const cellText = (cell: string) => (NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

export function writeExcelCells(table: TableData): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map(cellText).join("\t"));
  return lines.join("\n");
}

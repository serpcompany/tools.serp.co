// The table every table converter works on, and the CSV reading that the
// table pages (components/table-convert/convert.ts) and CSV to an image on
// the generic converter page (workerClient.ts) share; and the table pages'
// Excel input, read as cells copied from Excel (excel-cells.ts).

import Papa from "papaparse";
import { readExcelCells } from "./excel-cells.ts";

export type TableData = {
  headers: string[];
  rows: string[][];
};

// Every row gets one cell per header. A table without headers is named
// column_1, column_2... after its widest row.
export function normalizeTable(headers: string[], rows: string[][]): TableData {
  let maxColumns = headers.length;
  // A loop, not Math.max(...rows): spreading a large table overflows the stack.
  if (!maxColumns) for (const row of rows) maxColumns = Math.max(maxColumns, row.length);
  const safeHeaders = headers.length
    ? headers
    : Array.from({ length: maxColumns }, (_, index) => `column_${index + 1}`);
  const normalizedRows = rows.map((row) =>
    safeHeaders.map((_, index) => (row[index] ?? "").toString())
  );
  return { headers: safeHeaders, rows: normalizedRows };
}

export function parseCsvTable(text: string): { table: TableData | null; error: string | null } {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  // Papa can't guess the delimiter of a one-column CSV, which has none; it
  // reads it with a comma, which is right, so that warning isn't an error.
  const errors = parsed.errors.filter((error) => error.code !== "UndetectableDelimiter");
  if (errors.length) {
    return { table: null, error: errors[0]?.message ?? "CSV parse error" };
  }
  const data = parsed.data as string[][];
  const headerRow = data[0];
  if (!headerRow) {
    return { table: null, error: "CSV is empty." };
  }
  return { table: normalizeTable(headerRow, data.slice(1)), error: null };
}

// Cells copied from Excel, or a sheet as writeExcelCells (excel-cells.ts)
// writes it, read as readExcelCells reads them (`written`: the page wrote
// all of the text, which reads exactly as written), the first row the
// header.
export function parseExcelCells(text: string, written = false): { table: TableData | null; error: string | null } {
  return excelTable(readExcelCells(text, written));
}

// Rows of cells as a table, the first row the header. A row of one empty
// cell at the end is a blank line, not a row, as in readExcelCells and as a
// CSV input skips it; a row of empty cells (tabs) stays.
export function excelTable(rows: string[][]): { table: TableData | null; error: string | null } {
  for (let last = rows.at(-1); last && last.length === 1 && last[0] === ""; last = rows.at(-1)) rows.pop();
  const headerRow = rows[0];
  if (!headerRow) return { table: null, error: "There are no cells to convert." };
  return { table: normalizeTable(headerRow, rows.slice(1)), error: null };
}

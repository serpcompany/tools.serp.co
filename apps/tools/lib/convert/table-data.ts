// The table every table converter works on, and the CSV reading that the
// table pages (components/table-convert/convert.ts) and CSV to an image on
// the generic converter page (workerClient.ts) share; and the table pages'
// Excel input, read as cells copied from Excel (excel-cells.ts).

import Papa from "papaparse";

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
// writes it: tab-separated, quoted as Excel quotes, the first row the
// header. Excel ends the last row with a line break too; that isn't a row.
export function parseExcelCells(text: string): { table: TableData | null; error: string | null } {
  const parsed = Papa.parse<string[]>(text, { delimiter: "\t", skipEmptyLines: false });
  if (parsed.errors.length) {
    return { table: null, error: parsed.errors[0]?.message ?? "These cells couldn't be read." };
  }
  const data = parsed.data as string[][];
  while (data.length && data[data.length - 1]!.length === 1 && data[data.length - 1]![0] === "") data.pop();
  const headerRow = data[0];
  if (!headerRow) return { table: null, error: "There are no cells to convert." };
  return { table: normalizeTable(headerRow, data.slice(1)), error: null };
}

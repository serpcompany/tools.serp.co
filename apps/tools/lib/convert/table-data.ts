// The table every table converter works on, and the CSV reading that the
// table pages (components/table-convert/convert.ts) and CSV to an image on
// the generic converter page (workerClient.ts) share.

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

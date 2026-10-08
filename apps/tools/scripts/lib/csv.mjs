// CSV reading and writing for the generated data files (data/keywords.csv,
// benchmarks/tool-status.csv). Output is stable: LF line endings, a trailing
// newline, and quotes only where a cell needs them.

import Papa from "papaparse";

// Rows as objects keyed by the header row; every value is a string. The
// delimiter is detected, so a tab-separated export reads the same way.
export function parseCsv(text) {
  const { data, errors } = Papa.parse(text, { skipEmptyLines: "greedy" });
  // A one-column file has no delimiter to detect; that isn't an error.
  const fatal = errors.filter((error) => error.type !== "Delimiter");
  if (fatal.length) throw new Error(`CSV row ${fatal[0].row ?? "?"}: ${fatal[0].message}`);
  const [header = [], ...rows] = data;
  return rows.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""])));
}

// null and undefined become empty cells.
export function toCsv(columns, rows) {
  const data = rows.map((row) => columns.map((column) => row[column] ?? ""));
  return `${Papa.unparse({ fields: columns, data }, { newline: "\n" })}\n`;
}

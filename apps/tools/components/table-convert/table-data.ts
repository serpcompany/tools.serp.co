import type { TableData } from "./types";

export function tableDataToObjects(
  table: TableData,
): Array<Record<string, string>> {
  return table.rows.map((row) =>
    Object.fromEntries(
      table.headers.map((header, index) => [header, row[index] ?? ""]),
    ),
  );
}

export function objectsToTableData(
  records: Array<Record<string, unknown>>,
): TableData {
  const headers = [
    ...new Set(records.flatMap((record) => Object.keys(record))),
  ];
  return {
    headers,
    rows: records.map((record) =>
      headers.map((header) => {
        const value = record[header];
        if (value === null || value === undefined) return "";
        return typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
      }),
    ),
  };
}

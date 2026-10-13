// Reads an XLSX workbook's sheets as tables (issue #265) in a worker, so
// xlsx-workbook.ts can stop a workbook that takes too long to read, and the
// page stays responsive while it's read. For a table converter (`cells`,
// #266) each sheet comes back as the text its Excel input holds (cells as
// Excel copies them, excel-cells.ts): one string a sheet crosses to the page
// faster than its cells one by one.

import { TABLE_CELLS, writeExcelCells } from "./excel-cells.ts";
import { readWorkbookSheets, type WorkbookSheets } from "./xlsx-sheets.ts";

export type XlsxJob = { bytes: ArrayBuffer; cells?: boolean };
// A sheet as a table converter's Excel input: its name, its number among
// the workbook's sheets and its cells as text.
export type SheetText = { name: string; number: number; text: string };
export type WorkbookText = Omit<WorkbookSheets, "sheets"> & { sheets: SheetText[] };
// `error` is the message the page shows (a file it can't read says why).
export type XlsxReply =
  | ({ ok: true; cells?: false } & WorkbookSheets)
  | ({ ok: true; cells: true } & WorkbookText)
  | { ok: false; error: string };

export function readWorkbookJob(job: XlsxJob): XlsxReply {
  try {
    if (!job.cells) return { ok: true, ...readWorkbookSheets(job.bytes) };
    const { sheets, ...rest } = readWorkbookSheets(job.bytes, { cells: TABLE_CELLS });
    return {
      ok: true,
      cells: true,
      ...rest,
      sheets: sheets.map(({ name, number, table }) => ({ name, number, text: writeExcelCells(table) })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// In a worker (not when a test imports this module).
if (typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function") {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<XlsxJob>) => void) | null;
    postMessage: (message: XlsxReply) => void;
  };
  scope.onmessage = (event) => scope.postMessage(readWorkbookJob(event.data));
}

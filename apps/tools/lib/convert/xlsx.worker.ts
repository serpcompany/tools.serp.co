// Reads an XLSX workbook's sheets as tables (issue #265) in a worker, so
// xlsx-workbook.ts can stop a workbook that takes too long to read, and the
// page stays responsive while it's read.

import { readWorkbookSheets, type WorkbookSheets } from "./xlsx-sheets.ts";

export type XlsxJob = { bytes: ArrayBuffer };
// `error` is the message the page shows (a file it can't read says why).
export type XlsxReply = ({ ok: true } & WorkbookSheets) | { ok: false; error: string };

export function readWorkbookJob(job: XlsxJob): XlsxReply {
  try {
    return { ok: true, ...readWorkbookSheets(job.bytes) };
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

// An XLSX workbook's sheets read in a worker (xlsx.worker.ts) that is
// stopped after WORKBOOK_TIMEOUT_MS (issue #265): reading runs off the page's
// thread, and a workbook whose cells take too long to read fails with a
// message instead of keeping the tab busy. document-images.ts loads this
// module only when an XLSX file is converted, and a table converter page
// (#266) only when an Excel file is uploaded to it.

import type { WorkbookText, XlsxJob, XlsxReply } from "./xlsx.worker.ts";
import type { WorkbookSheets } from "./xlsx-sheets.ts";
import { runInWorker, type WorkerLike } from "./worker-run.ts";

// 10,000 rows in three sheets read in about half a second; a sheet at the
// 64 MB limit in a few.
export const WORKBOOK_TIMEOUT_MS = 60_000;

export const WORKBOOK_TIMEOUT_MESSAGE = `This workbook took more than ${WORKBOOK_TIMEOUT_MS / 1000} seconds to read in the browser, so it was stopped. Try saving the sheets you need in a smaller workbook.`;

const startWorker = (): WorkerLike<XlsxReply> => new Worker(new URL("./xlsx.worker.ts", import.meta.url), { type: "module" });

type WorkerOptions = { timeoutMs?: number; createWorker?: () => WorkerLike<XlsxReply> };

// Runs one job in a new worker that is terminated when it answers, fails,
// or runs past `timeoutMs` (an Error with code "layout_timeout"). The file's
// bytes are moved to the worker, not copied.
async function readInWorker(job: XlsxJob, { timeoutMs = WORKBOOK_TIMEOUT_MS, createWorker = startWorker }: WorkerOptions) {
  const reply = await runInWorker(createWorker(), job, {
    timeoutMs,
    timedOut: () => Object.assign(new Error(WORKBOOK_TIMEOUT_MESSAGE), { code: "layout_timeout" }),
    crashed: (event) => new Error(`The workbook stopped being read (${event.message || "out of memory"}).`),
    transfer: [job.bytes],
  });
  if (!reply.ok) throw new Error(reply.error);
  return reply;
}

// The workbook's sheets as tables, each with the rows and columns an image
// can show.
export async function readWorkbookInWorker(bytes: ArrayBuffer, options: WorkerOptions = {}): Promise<WorkbookSheets> {
  const reply = await readInWorker({ bytes }, options);
  if (reply.cells) throw new Error("The workbook was read as text, not tables.");
  return { sheets: reply.sheets, hidden: reply.hidden, skipped: reply.skipped, ...(reply.stop ? { stop: reply.stop } : {}) };
}

// The workbook's sheets as a table converter's Excel input: every row and
// column of each, as text, up to TABLE_CELLS cells and TABLE_CHARS
// characters in all (excel-cells.ts).
export async function readWorkbookTextInWorker(bytes: ArrayBuffer, options: WorkerOptions = {}): Promise<WorkbookText> {
  const reply = await readInWorker({ bytes, cells: true }, options);
  if (!reply.cells) throw new Error("The workbook was read as tables, not text.");
  return {
    sheets: reply.sheets,
    hidden: reply.hidden,
    skipped: reply.skipped,
    ...(reply.stop ? { stop: reply.stop } : {}),
    tooLarge: reply.tooLarge ?? [],
  };
}

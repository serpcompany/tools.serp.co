// What a table page may offer for download (#281 review). An output is
// offered only when it was written from the input on screen: not while a new
// file is still being read and parsed, not while the input shows an error,
// and not when it was written from an earlier table or for another format.
// Otherwise a second upload's Download saved the previous table under the new
// file's name.

import type { OutputFormat, TableData } from "./types.ts";

// A file being loaded into the page. Each upload, and each edit made after
// it, takes a new ticket; a read that finishes after a newer ticket was taken
// is dropped, so a slow earlier file can't replace a newer one.
export type Upload = { name: string; ticket: number; read: boolean } | null;

// The name downloads take (sales.csv saves as sales.json), and the file being
// loaded. A file's name is adopted only once its text is accepted into the
// input: a read that fails, or that typing or a newer file overtakes, keeps
// the previous name (or none), so the table on screen is never saved under a
// file's name it didn't come from.
export type UploadState = { fileName: string | null; upload: Upload };

export const NO_UPLOAD: UploadState = { fileName: null, upload: null };

export type UploadEvent =
  // A file was chosen or dropped.
  | { type: "start"; name: string; ticket: number }
  // Its text is in the input; the table is parsed from it next.
  | { type: "read"; ticket: number }
  // The input on screen was parsed.
  | { type: "parsed" }
  // The visitor typed, pasted or edited the grid, or the read failed.
  | { type: "cancel" }
  // The visitor cleared the input.
  | { type: "clear" };

export function nextUpload(state: UploadState, event: UploadEvent): UploadState {
  const { upload } = state;
  switch (event.type) {
    case "start":
      return { ...state, upload: { name: event.name, ticket: event.ticket, read: false } };
    case "read":
      return upload && upload.ticket === event.ticket
        ? { fileName: upload.name, upload: { ...upload, read: true } }
        : state;
    case "parsed":
      return upload?.read ? { ...state, upload: null } : state;
    case "cancel":
      return upload ? { ...state, upload: null } : state;
    case "clear":
      return state.fileName === null && !upload ? state : NO_UPLOAD;
  }
}

// The table and format an output was written from.
export type OutputSource = { table: TableData; format: OutputFormat };

export type PageInput = {
  upload: Upload;
  error: string | null;
  table: TableData | null;
  outputFormat: OutputFormat;
};

export function canOfferOutput(input: PageInput, written: OutputSource | null): boolean {
  if (input.upload || input.error || !input.table || !written) return false;
  return written.table === input.table && written.format === input.outputFormat;
}

// Whether choosing another input format rewrites the input from the table on
// screen (CSV text becomes the same table as JSON, say). Not while the input
// has an error: the table is then the last one that parsed, from earlier text
// or a previous upload, or the placeholder a page opens with, and rewriting
// the input from it would put that table under the new file's name. The new
// format re-parses the text on screen instead.
export function rewritesInputOnFormatChange(input: {
  table: TableData | null;
  hasUserInput: boolean;
  error: string | null;
}): boolean {
  return Boolean(input.table) && input.hasUserInput && !input.error;
}

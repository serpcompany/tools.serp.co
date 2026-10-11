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

export type UploadEvent =
  // A file was chosen or dropped.
  | { type: "start"; name: string; ticket: number }
  // Its text is in the input; the table is parsed from it next.
  | { type: "read"; ticket: number }
  // The input on screen was parsed.
  | { type: "parsed" }
  // The visitor typed, pasted, edited the grid or cleared the input, or the
  // read failed.
  | { type: "cancel" };

export function nextUpload(upload: Upload, event: UploadEvent): Upload {
  switch (event.type) {
    case "start":
      return { name: event.name, ticket: event.ticket, read: false };
    case "read":
      return upload && upload.ticket === event.ticket ? { ...upload, read: true } : upload;
    case "parsed":
      return upload?.read ? null : upload;
    case "cancel":
      return null;
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

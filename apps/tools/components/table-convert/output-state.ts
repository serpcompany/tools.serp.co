// A table page's input, the table on screen and the name Download saves it
// under (#281 reviews).
//
// The name follows the input text's origin, as #249 asks: the file whose
// text is in the input, as read or since edited (sales.csv saves as
// sales.json), or none for pasted text (table.json). A file's name is taken
// only in the update that puts its text in the input, so a file that can't
// be read never names anything. Typing, a grid edit or another input format
// edits that text and keeps its origin. A change that replaces all of the
// text (a paste over it, say), typing into an empty input, and Clear leave
// text of the visitor's own, with no origin. A read or parse that fails
// clears the table, and with it the grid and the download, but not the
// origin: once the text parses again, the download is named after it.
//
// The invariant: the download name and the downloadable output always
// describe the same table. The table on screen is the input parsed (or the
// placeholder), the name is that input's origin, and offeredDownload offers
// only an output written from the table on screen. The name changes only in
// updates that replace the table too, so an output written before can't
// take a name given after it.
//
// Every change to the input text, its format, the table and the name goes
// through nextTablePage; TableConvertDemo keeps no other copy of them.

import { outputFileName } from "./formats.ts";
import type { InputFormat, OutputFormat, TableData } from "./types.ts";

export type ParseTable = (
  format: InputFormat,
  text: string,
) => { table: TableData | null; supported: boolean; error?: string | null };

export type SerializeTable = (format: InputFormat, table: TableData) => { text: string; supported: boolean };

// A file chosen or dropped and still being read. Each upload takes a new
// ticket, so a read that finishes after a newer upload, typing, a grid edit
// or a clear is dropped.
export type Upload = { name: string; ticket: number } | null;

export type TablePage = {
  inputFormat: InputFormat;
  inputText: string;
  // False until the visitor types, pastes, edits or loads a file; the page
  // shows the placeholder table until then.
  hasUserInput: boolean;
  // The table on screen: in the grid, the previews and every output. Null
  // while the input doesn't read or parse.
  table: TableData | null;
  // The file the input's text came from, as read or since edited; null for
  // the visitor's own text and the placeholder. It stays while the text
  // doesn't parse, when nothing is offered.
  fileName: string | null;
  // Which table the grid may edit: it changes whenever a table starts afresh
  // (a file read, a failure, a clear) and stays through edits of that table.
  origin: number;
  error: string | null;
  upload: Upload;
};

export type TablePageEvent =
  // A file was chosen or dropped.
  | { type: "upload"; name: string; ticket: number }
  // Its text was read; `format` is the one its name or type says, if any.
  | { type: "read"; ticket: number; text: string; format: InputFormat | null }
  // It couldn't be read.
  | { type: "readFailed"; ticket: number; error: string }
  // The visitor typed, pasted or deleted in the input. `replacesInput`: the
  // change replaced all of its text (a paste over a select-all, say).
  | { type: "type"; text: string; replacesInput?: boolean }
  // The visitor edited the grid, which was showing the table of `origin`.
  | { type: "editGrid"; table: TableData; origin: number }
  // The visitor chose another input format.
  | { type: "inputFormat"; format: InputFormat }
  // The visitor cleared the input.
  | { type: "clear" };

export function initialTablePage(inputFormat: InputFormat, placeholder: TableData): TablePage {
  return {
    inputFormat,
    inputText: "",
    hasUserInput: false,
    table: placeholder,
    fileName: null,
    origin: 0,
    error: null,
    upload: null,
  };
}

export function tablePageReducer({
  parse,
  serialize,
  placeholder,
}: {
  parse: ParseTable;
  serialize: SerializeTable;
  placeholder: TableData;
}) {
  // Parses the input into the table on screen. A failure clears the table,
  // and with it the grid and any download, but the text keeps its origin.
  function settle(
    state: TablePage,
    input: Pick<TablePage, "inputFormat" | "inputText" | "hasUserInput" | "fileName" | "upload">,
    fromFile = false,
  ): TablePage {
    if (!input.hasUserInput && !input.inputText.trim()) {
      const continues = state.table === placeholder;
      return { ...state, ...input, fileName: null, table: placeholder, error: null, origin: continues ? state.origin : state.origin + 1 };
    }
    const result = parse(input.inputFormat, input.inputText);
    if (!result.supported || !result.table) {
      const error = result.error ?? (result.supported ? null : "Input format not supported.");
      return { ...state, ...input, table: null, error, origin: state.origin + 1 };
    }
    // An edit of the table on screen continues it; a file read, or a table
    // after a failure, starts afresh.
    const continues = Boolean(state.table) && !fromFile;
    return { ...state, ...input, table: result.table, error: null, origin: continues ? state.origin : state.origin + 1 };
  }

  return function nextTablePage(state: TablePage, event: TablePageEvent): TablePage {
    switch (event.type) {
      case "upload":
        return { ...state, upload: { name: event.name, ticket: event.ticket } };
      case "read": {
        const { upload } = state;
        if (!upload || upload.ticket !== event.ticket) return state;
        // The file's text is in the input now, so it takes the file's name.
        return settle(
          state,
          {
            inputFormat: event.format ?? state.inputFormat,
            inputText: event.text,
            hasUserInput: true,
            fileName: upload.name,
            upload: null,
          },
          true,
        );
      }
      case "readFailed":
        if (!state.upload || state.upload.ticket !== event.ticket) return state;
        // The input keeps its text, and that text its origin; the table goes.
        return { ...state, upload: null, table: null, error: event.error, origin: state.origin + 1 };
      case "type": {
        // Text that replaces all of the input, or is typed into an empty one,
        // is the visitor's own; any other change edits the text that was there.
        const own = event.replacesInput || !state.inputText.trim();
        return settle(state, {
          inputFormat: state.inputFormat,
          inputText: event.text,
          hasUserInput: true,
          fileName: own ? null : state.fileName,
          upload: null,
        });
      }
      case "editGrid": {
        // Only the table on screen can be edited: not a table the grid still
        // shows from before a file was read, nor one that failed to parse.
        if (!state.table || event.origin !== state.origin) return state;
        const asInput = serialize(state.inputFormat, event.table);
        if (!asInput.supported) {
          return { ...state, hasUserInput: true, table: event.table, upload: null, error: null };
        }
        return settle(state, {
          inputFormat: state.inputFormat,
          inputText: asInput.text,
          hasUserInput: true,
          fileName: state.fileName,
          upload: null,
        });
      }
      case "inputFormat": {
        if (event.format === state.inputFormat) return state;
        // A table parsed from the visitor's input is rewritten in the new
        // format (CSV text becomes the same table as JSON). Otherwise the text
        // on screen is parsed in the new format. Either way it's the same
        // text, so it keeps its origin.
        const { hasUserInput, upload, fileName } = state;
        const rewritten = state.table && hasUserInput ? serialize(event.format, state.table) : null;
        const inputText = rewritten?.supported ? rewritten.text : state.inputText;
        return settle(state, { inputFormat: event.format, inputText, hasUserInput, fileName, upload });
      }
      case "clear":
        return {
          ...state,
          inputText: "",
          hasUserInput: false,
          table: placeholder,
          fileName: null,
          origin: state.origin + 1,
          error: null,
          upload: null,
        };
    }
  };
}

// The table and format an output was written from.
export type OutputSource = { table: TableData; format: OutputFormat };

export type PageInput = Pick<TablePage, "upload" | "error" | "table"> & { outputFormat: OutputFormat };

// An output is offered only when it was written from the table on screen,
// for the output format chosen: not while a file is read, nor while the input
// has an error, nor when it was written from an earlier table.
export function canOfferOutput(input: PageInput, written: OutputSource | null): boolean {
  if (input.upload || input.error || !input.table || !written) return false;
  return written.table === input.table && written.format === input.outputFormat;
}

// What Download saves, or null when nothing may be saved: the output written
// from the table on screen, under the name of the file the input's text came
// from (or table.<extension>).
export function offeredDownload<T extends OutputSource>(
  page: TablePage,
  outputFormat: OutputFormat,
  written: T | null,
): { name: string; output: T } | null {
  if (!written || !canOfferOutput({ ...page, outputFormat }, written)) return null;
  return { name: outputFileName(page.fileName, outputFormat), output: written };
}

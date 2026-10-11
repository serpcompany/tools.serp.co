// A table page's input, the table on screen and the name Download saves it
// under (#281 reviews).
//
// The invariant: the download name and the downloadable output always
// describe the same table. A file's name is taken only when that file's text
// is read and parsed into the table on screen, in the same update that puts
// the table there. Every other change to the table (typing or pasting, an
// edit in the grid, another input format) keeps the name that table already
// had. A read or parse that fails clears the table, and with it the grid and
// the name, so nothing is offered until a table is on screen again; an edit
// made in a grid showing an earlier table is dropped.
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
  // The file the table on screen came from (sales.csv saves as sales.json);
  // null for typed or pasted input and the placeholder. Null whenever the
  // table is.
  fileName: string | null;
  // Which table the grid may edit: it changes whenever a table starts afresh
  // (a file read, a failure, a clear) and stays through edits of that table.
  origin: number;
  // The file whose text is in the input unchanged. If it didn't parse,
  // choosing the input format it does parse in still takes its name.
  textFrom: string | null;
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
  // The visitor typed or pasted into the input.
  | { type: "type"; text: string }
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
    textFrom: null,
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
  // Parses the input into the table on screen, and names it in the same
  // update: `name` is the name the table takes if the input parses. A failure
  // clears the table and the name together.
  function settle(
    state: TablePage,
    input: Pick<TablePage, "inputFormat" | "inputText" | "hasUserInput" | "textFrom" | "upload">,
    name: (continues: boolean) => string | null,
    fromFile = false,
  ): TablePage {
    if (!input.hasUserInput && !input.inputText.trim()) {
      const continues = state.table === placeholder;
      return { ...state, ...input, table: placeholder, fileName: null, error: null, origin: continues ? state.origin : state.origin + 1 };
    }
    const result = parse(input.inputFormat, input.inputText);
    if (!result.supported || !result.table) {
      const error = result.error ?? (result.supported ? null : "Input format not supported.");
      return { ...state, ...input, table: null, fileName: null, error, origin: state.origin + 1 };
    }
    // An edit of the table on screen keeps its name; a file read, or a table
    // after a failure, starts afresh.
    const continues = Boolean(state.table) && !fromFile;
    return {
      ...state,
      ...input,
      table: result.table,
      fileName: name(continues),
      error: null,
      origin: continues ? state.origin : state.origin + 1,
    };
  }

  // An edit keeps the name of the table it edits; a table typed after a
  // failure has none.
  const kept = (state: TablePage) => (continues: boolean) => (continues ? state.fileName : null);

  return function nextTablePage(state: TablePage, event: TablePageEvent): TablePage {
    switch (event.type) {
      case "upload":
        return { ...state, upload: { name: event.name, ticket: event.ticket } };
      case "read": {
        const { upload } = state;
        if (!upload || upload.ticket !== event.ticket) return state;
        return settle(
          state,
          {
            inputFormat: event.format ?? state.inputFormat,
            inputText: event.text,
            hasUserInput: true,
            textFrom: upload.name,
            upload: null,
          },
          () => upload.name,
          true,
        );
      }
      case "readFailed":
        if (!state.upload || state.upload.ticket !== event.ticket) return state;
        // The input keeps the text it had; the table and name go.
        return { ...state, upload: null, table: null, fileName: null, error: event.error, origin: state.origin + 1 };
      case "type":
        return settle(
          state,
          { inputFormat: state.inputFormat, inputText: event.text, hasUserInput: true, textFrom: null, upload: null },
          kept(state),
        );
      case "editGrid": {
        // Only the table on screen can be edited: not a table the grid still
        // shows from before a file was read, nor one that failed to parse.
        if (!state.table || event.origin !== state.origin) return state;
        const asInput = serialize(state.inputFormat, event.table);
        if (!asInput.supported) {
          return { ...state, hasUserInput: true, table: event.table, textFrom: null, upload: null, error: null };
        }
        return settle(
          state,
          { inputFormat: state.inputFormat, inputText: asInput.text, hasUserInput: true, textFrom: null, upload: null },
          kept(state),
        );
      }
      case "inputFormat": {
        if (event.format === state.inputFormat) return state;
        // A table parsed from the visitor's input is rewritten in the new
        // format (CSV text becomes the same table as JSON). Otherwise the text
        // on screen is parsed in the new format; if it's a file's text,
        // untouched, the table takes that file's name.
        const { hasUserInput, upload } = state;
        const rewritten = state.table && hasUserInput ? serialize(event.format, state.table) : null;
        if (rewritten?.supported) {
          return settle(
            state,
            { inputFormat: event.format, inputText: rewritten.text, hasUserInput, textFrom: null, upload },
            kept(state),
          );
        }
        return settle(
          state,
          { inputFormat: event.format, inputText: state.inputText, hasUserInput, textFrom: state.textFrom, upload },
          (continues) => (continues ? state.fileName : state.textFrom),
        );
      }
      case "clear":
        return {
          ...state,
          inputText: "",
          hasUserInput: false,
          table: placeholder,
          fileName: null,
          origin: state.origin + 1,
          textFrom: null,
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
// from the table on screen, under the name of the file that table came from
// (or table.<extension>).
export function offeredDownload<T extends OutputSource>(
  page: TablePage,
  outputFormat: OutputFormat,
  written: T | null,
): { name: string; output: T } | null {
  if (!written || !canOfferOutput({ ...page, outputFormat }, written)) return null;
  return { name: outputFileName(page.fileName, outputFormat), output: written };
}

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
//
// An Excel workbook (#266) is read in a worker into the text an Excel input
// holds, each sheet's cells as Excel copies them, and arrives as one event:
// its first sheet's text goes into the input, which takes the file's name,
// as any file's text does. Its other sheets stay with that text: choosing
// one replaces the input with that sheet's text, from the same file, so the
// name stays. They go when the name does. Each sheet keeps its grid edits:
// while the input is Excel, the sheet shown holds the input's text, so
// choosing another sheet and coming back brings the edits back (#299
// review).
//
// After an Excel upload the input's text is read-only (#299, the owner's
// decision): a workbook's sheet, or an Excel file that is text (an .xls of
// tab-separated cells or an HTML table). Its cells are edited in the grid,
// whose edits the page writes into the input, and Clear empties the input
// and makes it editable again. Typing then can't mix the visitor's quotes
// into text the page wrote, where they could read two ways (review rounds 2
// to 4). So how an Excel input's text reads depends only on who wrote all of
// it (excel-cells.ts): `written` text, which the page wrote (a sheet, a grid
// edit, a table rewritten in the input's format, a paste written its own
// way) and nobody typed in since, reads exactly as written; text the
// visitor typed or pasted, or edited, reads the visitor's way.

import type { WorkbookText } from "../../lib/convert/xlsx.worker.ts";
import { outputFileName } from "./formats.ts";
import type { InputFormat, OutputFormat, TableData } from "./types.ts";

// `written`: the page wrote all of the text, and nobody typed in it since.
export type ParseTable = (
  format: InputFormat,
  text: string,
  written: boolean,
) => { table: TableData | null; supported: boolean; error?: string | null };

export type SerializeTable = (format: InputFormat, table: TableData) => { text: string; supported: boolean };

// A file chosen or dropped and still being read. Each upload takes a new
// ticket, so a read that finishes after a newer upload, typing, a grid edit
// or a clear is dropped.
export type Upload = { name: string; ticket: number } | null;

// A workbook read for an Excel input: its sheets with values, each as the
// text the input holds for it, what was left out (hidden sheets, sheets too
// large, sheets not read).
export type WorkbookRead = Omit<WorkbookText, "sheets"> & { sheets: { name: string; text: string }[] };

// That workbook on the page: each sheet's text as read, or as last edited
// in the grid, and which sheet the input's text came from.
export type Workbook = Omit<WorkbookRead, "sheets"> & { sheets: { name: string; text: string }[]; sheet: number };

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
  // The workbook the input's text came from: there exactly while the text's
  // origin (fileName) is a workbook, as read or since edited.
  workbook: Workbook | null;
  // The input's text is an Excel file's (a workbook's sheet, or an Excel
  // file that is text), as read or as the page rewrote it: the visitor can't
  // type in it, only edit the grid, until Clear. Only with a fileName, and
  // always with a workbook.
  readOnly: boolean;
  // The page wrote all of the input's text, and nobody typed in it since: it
  // reads exactly as written.
  written: boolean;
};

export type TablePageEvent =
  // A file was chosen or dropped.
  | { type: "upload"; name: string; ticket: number }
  // Its text was read; `format` is the one its name or type says, if any.
  // `fromExcel`: the file is an Excel file that is text (an .xls of
  // tab-separated cells or an HTML table), read-only as a workbook is.
  | { type: "read"; ticket: number; text: string; format: InputFormat | null; fromExcel?: boolean }
  // It was read as an Excel workbook, its sheets as an Excel input's text.
  | { type: "readWorkbook"; ticket: number; workbook: WorkbookRead }
  // The visitor chose another sheet of the workbook the input came from.
  | { type: "sheet"; sheet: number }
  // It couldn't be read.
  | { type: "readFailed"; ticket: number; error: string }
  // The visitor typed, pasted or deleted in the input. `replacesInput`: the
  // change replaced all of its text (a paste over a select-all, say).
  // `written`: the page wrote all of `text`, a paste it wrote its own way
  // over all of the input (TableConvertDemo, excel-paste.ts).
  | { type: "type"; text: string; replacesInput?: boolean; written?: boolean }
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
    workbook: null,
    readOnly: false,
    written: false,
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
  // The workbook's sheet shown takes the text of an Excel input, edited or
  // not; in another format the text isn't a sheet's, and the sheet keeps
  // the last it had.
  function settle(
    state: TablePage,
    edited: Pick<TablePage, "inputFormat" | "inputText" | "hasUserInput" | "fileName" | "upload" | "workbook" | "readOnly" | "written">,
    fromFile = false,
  ): TablePage {
    const { workbook } = edited;
    const input = workbook && edited.inputFormat === "excel" ? { ...edited, workbook: keepSheetText(workbook, edited.inputText) } : edited;
    if (!input.hasUserInput && !input.inputText.trim()) {
      const continues = state.table === placeholder;
      return {
        ...state,
        ...input,
        fileName: null,
        workbook: null,
        readOnly: false,
        table: placeholder,
        error: null,
        origin: continues ? state.origin : state.origin + 1,
      };
    }
    const result = parse(input.inputFormat, input.inputText, input.written);
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
        // It's the file's text, not the page's: read the visitor's way, and
        // read-only when it's an Excel file's.
        return settle(
          state,
          {
            inputFormat: event.format ?? state.inputFormat,
            inputText: event.text,
            hasUserInput: true,
            fileName: upload.name,
            upload: null,
            workbook: null,
            readOnly: Boolean(event.fromExcel),
            written: false,
          },
          true,
        );
      }
      case "readWorkbook": {
        const { upload } = state;
        if (!upload || upload.ticket !== event.ticket) return state;
        const first = event.workbook.sheets[0];
        // A workbook with no sheet to show is a file that can't be read.
        if (!first) {
          return { ...state, upload: null, table: null, error: `${upload.name} has no visible sheet with values.`, origin: state.origin + 1 };
        }
        // Its first sheet's text is in the input, as an Excel input's, and
        // takes the file's name. The page wrote each sheet's text, and the
        // input is read-only.
        return settle(
          state,
          {
            inputFormat: "excel",
            inputText: first.text,
            hasUserInput: true,
            fileName: upload.name,
            upload: null,
            workbook: { ...event.workbook, sheet: 0 },
            readOnly: true,
            written: true,
          },
          true,
        );
      }
      case "sheet": {
        const { workbook } = state;
        const sheet = workbook?.sheets[event.sheet];
        if (!workbook || !sheet || state.inputFormat !== "excel" || event.sheet === workbook.sheet) return state;
        // The chosen sheet's text replaces the input's, from the same file:
        // a table afresh under the same name, the page's text, read-only.
        // Like a grid edit, it wins over a file still being read.
        return settle(
          state,
          {
            inputFormat: "excel",
            inputText: sheet.text,
            hasUserInput: true,
            fileName: state.fileName,
            upload: null,
            workbook: { ...workbook, sheet: event.sheet },
            readOnly: true,
            written: true,
          },
          true,
        );
      }
      case "readFailed":
        if (!state.upload || state.upload.ticket !== event.ticket) return state;
        // The input keeps its text, and that text its origin; the table goes.
        return { ...state, upload: null, table: null, error: event.error, origin: state.origin + 1 };
      case "type": {
        // Read-only text can't be typed in: the page's textarea is read-only,
        // and a stray change changes nothing.
        if (state.readOnly) return state;
        // Text that replaces all of the input, or is typed into an empty one,
        // is the visitor's own; any other change edits the text that was
        // there. Either way it's the visitor's text now, read the visitor's
        // way, unless the page wrote all of it (a paste it wrote).
        const own = event.replacesInput || !state.inputText.trim();
        return settle(state, {
          inputFormat: state.inputFormat,
          inputText: event.text,
          hasUserInput: true,
          fileName: own ? null : state.fileName,
          upload: null,
          workbook: own ? null : state.workbook,
          readOnly: false,
          written: Boolean(event.written),
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
        // The page writes the grid's table into the input: all of it is the
        // page's text, read-only still if it was.
        return settle(state, {
          inputFormat: state.inputFormat,
          inputText: asInput.text,
          hasUserInput: true,
          fileName: state.fileName,
          upload: null,
          workbook: state.workbook,
          readOnly: state.readOnly,
          written: true,
        });
      }
      case "inputFormat": {
        if (event.format === state.inputFormat) return state;
        // A table parsed from the visitor's input is rewritten in the new
        // format (CSV text becomes the same table as JSON), which the page
        // wrote. Otherwise the text on screen is parsed in the new format.
        // Either way it's the same text, so it keeps its origin, and stays
        // read-only if it was.
        const { hasUserInput, upload, fileName, workbook, readOnly } = state;
        const rewritten = state.table && hasUserInput ? serialize(event.format, state.table) : null;
        const inputText = rewritten?.supported ? rewritten.text : state.inputText;
        const written = rewritten?.supported ? true : state.written;
        return settle(state, { inputFormat: event.format, inputText, hasUserInput, fileName, upload, workbook, readOnly, written });
      }
      case "clear":
        // The input is empty and the visitor's to type or paste in.
        return {
          ...state,
          inputText: "",
          hasUserInput: false,
          table: placeholder,
          fileName: null,
          origin: state.origin + 1,
          error: null,
          upload: null,
          workbook: null,
          readOnly: false,
          written: false,
        };
    }
  };
}

// The workbook with its sheet shown holding `text`.
function keepSheetText(workbook: Workbook, text: string): Workbook {
  const shown = workbook.sheets[workbook.sheet];
  if (!shown || shown.text === text) return workbook;
  const sheets = workbook.sheets.map((sheet, index) => (index === workbook.sheet ? { ...sheet, text } : sheet));
  return { ...workbook, sheets };
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

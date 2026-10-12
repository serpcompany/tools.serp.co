// An XLSX workbook read as tables (issue #265), for XLSX to an image: each
// sheet a visitor would see in Excel, its cells as Excel shows them (numbers
// in their number format, dates as dates, formulas as their saved result),
// its first row as the header. Hidden and very hidden sheets, hidden rows
// and hidden columns are left out, as Excel leaves them out of a printout.
// Charts, pictures, comments and cell styles aren't read.
//
// Read with fflate (already the app's ZIP library) and a small XML scanner
// (ooxml.ts), on the main thread: a workbook part is inflated only when it's
// needed and only up to the size its ZIP entry declares, so a ZIP bomb can't
// fill the tab's memory.

import { BUILT_IN_FORMATS, formatCellNumber } from "./excel-number-format.ts";
import {
  isOleFile,
  isZipFile,
  mainPartPath,
  parseRelationships,
  partText as text,
  readParts,
  relationshipsPath,
  scanXml,
} from "./ooxml.ts";
import type { TableData } from "./table-data.ts";

// A part bigger than this (inflated) isn't read: about 500,000 rows of ten
// columns.
export const MAX_PART_BYTES = 64 * 1024 * 1024;
// Rows and columns kept with their cells. An image shows far fewer (about
// 55 rows and 50 columns, table-image.ts); the rest are only counted.
export const KEPT_ROWS = 500;
export const KEPT_COLUMNS = 200;
// The most sheets one workbook becomes images of.
export const MAX_SHEETS = 100;

export type Sheet = { name: string; table: TableData };

// --------------------------------------------------------------- strings --

// Excel writes characters XML can't hold as _xHHHH_ (and a literal
// "_x0041_" as "_x005F_x0041_").
export function decodeExcelEscapes(text: string): string {
  if (!text.includes("_x")) return text;
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

// ------------------------------------------------------------ the parts --

type WorkbookInfo = {
  date1904: boolean;
  sheets: { name: string; state: string; relation: string }[];
};

export function parseWorkbook(xml: string): WorkbookInfo {
  const info: WorkbookInfo = { date1904: false, sheets: [] };
  scanXml(xml, {
    open(name, attributes) {
      if (name === "workbookPr") info.date1904 = attributes.date1904 === "1" || attributes.date1904 === "true";
      if (name === "sheet") {
        info.sheets.push({ name: attributes.name ?? "", state: attributes.state ?? "visible", relation: attributes.id ?? "" });
      }
    },
  });
  return info;
}

export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let current: string | null = null;
  let inText = false;
  let phonetic = 0;
  scanXml(xml, {
    open(name, _attributes, selfClosing) {
      if (name === "si") current = "";
      else if (name === "rPh") phonetic += selfClosing ? 0 : 1;
      else if (name === "t" && !selfClosing) inText = true;
    },
    close(name) {
      if (name === "si" && current !== null) {
        strings.push(decodeExcelEscapes(current));
        current = null;
      } else if (name === "rPh") phonetic = Math.max(0, phonetic - 1);
      else if (name === "t") inText = false;
    },
    text(text) {
      if (current !== null && inText && !phonetic) current += text;
    },
  });
  return strings;
}

// Each cell style's number format code, by style index.
export function parseStyles(xml: string): string[] {
  const custom = new Map<number, string>();
  const formats: string[] = [];
  let inCellXfs = false;
  scanXml(xml, {
    open(name, attributes) {
      if (name === "numFmt") custom.set(Number(attributes.numFmtId), attributes.formatCode ?? "General");
      else if (name === "cellXfs") inCellXfs = true;
      else if (name === "xf" && inCellXfs) {
        const id = Number(attributes.numFmtId ?? 0);
        formats.push(custom.get(id) ?? BUILT_IN_FORMATS[id] ?? "General");
      }
    },
    close(name) {
      if (name === "cellXfs") inCellXfs = false;
    },
  });
  return formats;
}

// "AB12" as 0-based column 27 and row 11.
export function cellPosition(reference: string): { row: number; column: number } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(reference);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]!.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, column: column - 1 };
}

type CellContext = { strings: string[]; formats: string[]; date1904: boolean };

// The text a cell shows, from its type, its value and its style.
export function cellText(type: string, value: string, style: number, context: CellContext): string {
  switch (type) {
    case "s":
      return context.strings[Number(value)] ?? "";
    case "inlineStr":
    case "str":
      return decodeExcelEscapes(value);
    case "b":
      return value.trim() === "1" ? "TRUE" : value.trim() === "0" ? "FALSE" : value;
    case "e":
      return value;
    case "d": {
      // An ISO 8601 date, shown in its style's format as a serial date.
      const time = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
      if (Number.isNaN(time)) return value;
      const serial = (time - Date.UTC(1899, 11, 30)) / 86400000;
      return formatCellNumber(serial, context.formats[style] ?? "m/d/yyyy", false);
    }
    default: {
      if (value.trim() === "") return "";
      const number = Number(value);
      if (!Number.isFinite(number)) return value;
      return formatCellNumber(number, context.formats[style] ?? "General", context.date1904);
    }
  }
}

type SheetCells = {
  // Rows with a value, in order, kept up to KEPT_ROWS: row index and its
  // cells by column.
  rows: { index: number; cells: Map<number, string> }[];
  hiddenRows: Set<number>;
  hiddenColumns: Set<number>;
  // Rows not listed are hidden too (sheetFormatPr zeroHeight).
  listedRows: Set<number> | null;
  first: { row: number; column: number } | null;
  last: { row: number; column: number };
};

// A worksheet's cells that show: values in visible rows and columns.
export function parseSheet(xml: string, context: CellContext): SheetCells {
  const sheet: SheetCells = {
    rows: [],
    hiddenRows: new Set(),
    hiddenColumns: new Set(),
    listedRows: null,
    first: null,
    last: { row: -1, column: -1 },
  };
  let rowIndex = -1;
  let rowHidden = false;
  let rowCells: Map<number, string> | null = null;
  let column = -1;
  let cell: { type: string; style: number; value: string; inValue: boolean; phonetic: number } | null = null;
  let inSheetData = false;

  const finishRow = () => {
    if (rowCells?.size && sheet.rows.length < KEPT_ROWS) sheet.rows.push({ index: rowIndex, cells: rowCells });
    rowCells = null;
  };

  scanXml(xml, {
    open(name, attributes, selfClosing) {
      if (name === "sheetFormatPr" && (attributes.zeroHeight === "1" || attributes.zeroHeight === "true")) {
        sheet.listedRows = new Set();
      } else if (name === "col" && (attributes.hidden === "1" || attributes.hidden === "true")) {
        const min = Number(attributes.min);
        const max = Math.min(Number(attributes.max), 16384);
        for (let index = min; index <= max; index += 1) sheet.hiddenColumns.add(index - 1);
      } else if (name === "sheetData") {
        inSheetData = true;
      } else if (!inSheetData) {
        return;
      } else if (name === "row") {
        finishRow();
        rowIndex = attributes.r ? Number(attributes.r) - 1 : rowIndex + 1;
        rowHidden = attributes.hidden === "1" || attributes.hidden === "true";
        if (rowHidden) sheet.hiddenRows.add(rowIndex);
        sheet.listedRows?.add(rowIndex);
        rowCells = new Map();
        column = -1;
      } else if (name === "c") {
        const position = attributes.r ? cellPosition(attributes.r) : null;
        column = position ? position.column : column + 1;
        cell = selfClosing ? null : { type: attributes.t ?? "n", style: Number(attributes.s ?? 0), value: "", inValue: false, phonetic: 0 };
      } else if (cell && (name === "v" || name === "t")) {
        cell.inValue = !selfClosing;
      } else if (cell && name === "rPh") {
        cell.phonetic += selfClosing ? 0 : 1;
      }
    },
    close(name) {
      if (name === "sheetData") {
        finishRow();
        inSheetData = false;
      } else if (!inSheetData) {
        return;
      } else if (name === "v" || name === "t") {
        if (cell) cell.inValue = false;
      } else if (name === "rPh") {
        if (cell) cell.phonetic = Math.max(0, cell.phonetic - 1);
      } else if (name === "c" && cell) {
        const shown = rowHidden || sheet.hiddenColumns.has(column) ? "" : cellText(cell.type, cell.value, cell.style, context);
        cell = null;
        if (!shown.trim() || column < 0 || rowIndex < 0) return;
        // A row's cells arrive left to right, so its first KEPT_COLUMNS
        // values cover every column a table of KEPT_COLUMNS can show.
        if (sheet.rows.length < KEPT_ROWS && rowCells && rowCells.size < KEPT_COLUMNS) rowCells.set(column, shown);
        sheet.first ??= { row: rowIndex, column };
        sheet.first.row = Math.min(sheet.first.row, rowIndex);
        sheet.first.column = Math.min(sheet.first.column, column);
        sheet.last = { row: Math.max(sheet.last.row, rowIndex), column: Math.max(sheet.last.column, column) };
      }
    },
    text(text) {
      if (cell?.inValue && !cell.phonetic) cell.value += text;
    },
  });
  return sheet;
}

// The cells as a table: the rows and columns from the first value to the
// last that aren't hidden, the first row as its header. Rows past KEPT_ROWS
// and columns past KEPT_COLUMNS are counted but not filled in: the rows are
// holes in `rows` (table-image.ts draws a missing row as empty, and never
// gets that far down) and the columns empty headers, so the image's note
// says how many there are.
export function sheetTable(cells: SheetCells): TableData | null {
  if (!cells.first) return null;
  const columns: number[] = [];
  let columnCount = 0;
  for (let column = cells.first.column; column <= cells.last.column; column += 1) {
    if (cells.hiddenColumns.has(column)) continue;
    columnCount += 1;
    if (columns.length < KEPT_COLUMNS) columns.push(column);
  }
  const shows = (row: number) => !cells.hiddenRows.has(row) && (!cells.listedRows || cells.listedRows.has(row));
  const byIndex = new Map(cells.rows.map((row) => [row.index, row.cells]));
  const lastKept = cells.rows[cells.rows.length - 1]?.index ?? -1;
  let header: string[] = [];
  const rows: string[][] = [];
  let count = 0;
  for (let row = cells.first.row; row <= cells.last.row; row += 1) {
    if (!shows(row)) continue;
    if (row <= lastKept && count <= KEPT_ROWS) {
      const values = byIndex.get(row);
      const line = columns.map((column) => values?.get(column) ?? "");
      if (count === 0) header = line;
      else rows[count - 1] = line;
    }
    count += 1;
  }
  rows.length = Math.max(0, count - 1);
  return { headers: Array.from({ length: columnCount }, (_, index) => header[index] ?? ""), rows };
}

// ----------------------------------------------------------------- read --

// The workbook's sheets that show, in order, as tables (up to MAX_SHEETS),
// how many hidden sheets were left out, and how many past MAX_SHEETS; sheets
// with no values are left out too.
export function readWorkbookSheets(buf: ArrayBuffer): { sheets: Sheet[]; hidden: number; skipped: number } {
  const bytes = new Uint8Array(buf);
  if (isOleFile(bytes)) {
    throw new Error(
      "This is an older Excel workbook (.xls) or a password-protected one: open it in Excel and save it as an unprotected .xlsx first.",
    );
  }
  if (!isZipFile(bytes)) throw new Error("This file isn't an XLSX workbook: it isn't a ZIP archive.");
  const read = {
    maxBytes: MAX_PART_BYTES,
    tooBig: `This workbook is too large to draw here: a sheet holds more than ${MAX_PART_BYTES / 1024 / 1024} MB of cells.`,
    kind: "XLSX file",
  };
  const workbookPath = mainPartPath(bytes, "xl/workbook.xml", read);
  const relsPath = relationshipsPath(workbookPath);
  const head = readParts(bytes, (name) => name === workbookPath || name === relsPath, read);
  if (!head[workbookPath]) throw new Error("This file isn't an XLSX workbook: it has no workbook part.");
  const workbook = parseWorkbook(text(head[workbookPath]));
  const relationships = parseRelationships(text(head[relsPath]), workbookPath);
  const target = (suffix: string) => [...relationships.values()].find((relation) => relation.type.endsWith(suffix))?.target;
  const stringsPath = target("/sharedStrings");
  const stylesPath = target("/styles");

  const visible = workbook.sheets
    .filter((sheet) => sheet.state === "visible")
    .map((sheet) => ({ name: sheet.name, relation: relationships.get(sheet.relation) }))
    .filter((sheet) => sheet.relation?.type.endsWith("/worksheet"));
  const shared = new Set([stringsPath, stylesPath].filter(Boolean));
  const parts = readParts(bytes, (name) => shared.has(name), read);
  const context: CellContext = {
    strings: stringsPath ? parseSharedStrings(text(parts[stringsPath])) : [],
    formats: stylesPath ? parseStyles(text(parts[stylesPath])) : [],
    date1904: workbook.date1904,
  };
  // One sheet inflated at a time, so a workbook of many large sheets holds
  // one in memory.
  const sheets: Sheet[] = [];
  for (const sheet of visible.slice(0, MAX_SHEETS)) {
    const path = sheet.relation!.target;
    const xml = text(readParts(bytes, (name) => name === path, read)[path]);
    const table = xml ? sheetTable(parseSheet(xml, context)) : null;
    if (table) sheets.push({ name: sheet.name, table });
  }
  return {
    sheets,
    hidden: workbook.sheets.filter((sheet) => sheet.state !== "visible").length,
    skipped: Math.max(0, visible.length - MAX_SHEETS),
  };
}

// An XLSX workbook read as tables (issue #265), for XLSX to an image: each
// sheet a visitor would see in Excel, its cells as Excel shows them (numbers
// in their number format, dates as dates, formulas as their saved result),
// its first row as the header. Hidden and very hidden sheets, hidden rows
// and hidden columns are left out, as Excel leaves them out of a printout.
// Charts, pictures, comments and cell styles aren't read.
//
// Read with fflate (already the app's ZIP library) and a small XML scanner
// (ooxml.ts), in a worker with a time limit (xlsx.worker.ts,
// xlsx-workbook.ts): a workbook part is inflated only when it's needed and
// only up to the size its ZIP entry declares, the parts read add up to at
// most MAX_WORKBOOK_BYTES, and row and column numbers stay inside Excel's
// grid, so a small file can't fill the tab's memory or keep it busy.

import { BUILT_IN_FORMATS, formatCellNumber, formatCellText } from "./excel-number-format.ts";
import {
  isOleFile,
  isZipFile,
  listParts,
  mainPartPath,
  parseRelationships,
  partText as text,
  readParts,
  relationEndingIn,
  relationshipId,
  relationshipsPath,
  scanXml,
} from "./ooxml.ts";
import type { TableData } from "./table-data.ts";

// A part bigger than this (inflated) isn't read: about 500,000 rows of ten
// columns.
export const MAX_PART_BYTES = 64 * 1024 * 1024;
// The parts one workbook reads add up to at most this, inflated: a few MB of
// ZIP can declare far more.
export const MAX_WORKBOOK_BYTES = 256 * 1024 * 1024;
// Excel's grid: a row or column number outside it isn't a cell Excel shows.
export const MAX_ROWS = 1_048_576;
export const MAX_COLUMNS = 16_384;
// Rows and columns kept with their cells. An image shows far fewer (about
// 55 rows and 50 columns, table-image.ts); the rest are only counted.
export const KEPT_ROWS = 500;
export const KEPT_COLUMNS = 200;
// The most sheets one workbook becomes images of.
export const MAX_SHEETS = 100;

// A sheet's name, its number (its place among all the workbook's sheets,
// hidden ones counted, from 1) and its cells.
export type Sheet = { name: string; number: number; table: TableData };

export type WorkbookSheets = {
  sheets: Sheet[];
  // Hidden and very hidden sheets, left out.
  hidden: number;
  // Visible sheets not read, and why: MAX_SHEETS images were made, or the
  // parts read reached MAX_WORKBOOK_BYTES.
  skipped: number;
  stop?: "sheets" | "size";
};

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
        info.sheets.push({ name: attributes.name ?? "", state: attributes.state ?? "visible", relation: relationshipId(attributes) ?? "" });
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

// A row number ("12") as a 0-based row, or null outside Excel's grid.
export function rowNumber(text: string): number | null {
  if (!/^\s*\d{1,7}\s*$/.test(text)) return null;
  const row = Number(text);
  return row >= 1 && row <= MAX_ROWS ? row - 1 : null;
}

// "AB12" as 0-based column 27 and row 11, or null when it isn't a cell
// reference inside Excel's grid (A1 to XFD1048576).
export function cellPosition(reference: string): { row: number; column: number } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(reference);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]!.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  const row = rowNumber(match[2]!);
  return row === null || column > MAX_COLUMNS ? null : { row, column: column - 1 };
}

type CellContext = { strings: string[]; formats: string[]; date1904: boolean };

// The text a cell shows, from its type, its value and its style. Text and
// TRUE/FALSE go through the format's text section, so a format that hides
// them (";;;") hides them here too.
export function cellText(type: string, value: string, style: number, context: CellContext): string {
  const format = context.formats[style] ?? "General";
  switch (type) {
    case "s":
      return formatCellText(context.strings[Number(value)] ?? "", format);
    case "inlineStr":
    case "str":
      return formatCellText(decodeExcelEscapes(value), format);
    case "b":
      return formatCellText(value.trim() === "1" ? "TRUE" : value.trim() === "0" ? "FALSE" : value, format);
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
      return formatCellNumber(number, format, context.date1904);
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

// A worksheet's cells that show: values in visible rows and columns. A row
// or cell numbered outside Excel's grid (row 0, row 2000000, column XFE, a
// number that isn't one) isn't a cell Excel shows, and is left out.
export function parseSheet(xml: string, context: CellContext): SheetCells {
  const sheet: SheetCells = {
    rows: [],
    hiddenRows: new Set(),
    hiddenColumns: new Set(),
    listedRows: null,
    first: null,
    last: { row: -1, column: -1 },
  };
  // The current row (0-based), or -1 while in a row outside the grid; the
  // last row inside it, which a row with no number follows.
  let rowIndex = -1;
  let lastRow = -1;
  let rowHidden = false;
  let rowCells: Map<number, string> | null = null;
  // The current cell's column (0-based), or -1 when it's outside the grid;
  // the last column inside it, which a cell with no reference follows.
  let column = -1;
  let lastColumn = -1;
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
        const min = Math.max(1, Number(attributes.min));
        const max = Math.min(MAX_COLUMNS, Number(attributes.max));
        // NaN fails both tests, so a range that isn't numbers hides nothing.
        if (!(min <= max)) return;
        for (let index = min; index <= max; index += 1) sheet.hiddenColumns.add(index - 1);
      } else if (name === "sheetData") {
        inSheetData = true;
      } else if (!inSheetData) {
        return;
      } else if (name === "row") {
        finishRow();
        const numbered = attributes.r === undefined ? lastRow + 1 : rowNumber(attributes.r);
        rowIndex = numbered !== null && numbered < MAX_ROWS ? numbered : -1;
        if (rowIndex >= 0) lastRow = rowIndex;
        rowHidden = attributes.hidden === "1" || attributes.hidden === "true";
        if (rowHidden && rowIndex >= 0) sheet.hiddenRows.add(rowIndex);
        if (rowIndex >= 0) sheet.listedRows?.add(rowIndex);
        rowCells = rowIndex >= 0 ? new Map() : null;
        lastColumn = -1;
      } else if (name === "c") {
        const numbered = attributes.r === undefined ? lastColumn + 1 : (cellPosition(attributes.r)?.column ?? null);
        column = numbered !== null && numbered < MAX_COLUMNS ? numbered : -1;
        if (column >= 0) lastColumn = column;
        cell = selfClosing || column < 0 || rowIndex < 0 ? null : { type: attributes.t ?? "n", style: Number(attributes.s ?? 0), value: "", inValue: false, phonetic: 0 };
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

// The workbook's sheets that show, in order, as tables, sheets with no
// values left out: up to MAX_SHEETS of them, read until the parts read add
// up to MAX_WORKBOOK_BYTES. Says how many hidden sheets were left out, and
// how many visible sheets weren't read and why. A worksheet part two sheets
// name is read once.
export function readWorkbookSheets(buf: ArrayBuffer, { budget = MAX_WORKBOOK_BYTES }: { budget?: number } = {}): WorkbookSheets {
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
  const tooLarge = `This workbook is too large to draw here: its sheets hold more than ${Math.round(budget / 1024 / 1024)} MB of cells.`;
  // Each part's declared size, inflated, and the running total of the parts
  // read.
  let sizes: Map<string, number>;
  try {
    sizes = new Map(listParts(bytes).map((part) => [part.name, part.size]));
  } catch {
    throw new Error(`This ${read.kind} couldn't be read: it isn't a complete ZIP archive.`);
  }
  let used = 0;
  const take = (paths: (string | undefined)[]) => {
    for (const path of new Set(paths)) used += path ? (sizes.get(path) ?? 0) : 0;
  };

  const workbookPath = mainPartPath(bytes, "xl/workbook.xml", read);
  const relsPath = relationshipsPath(workbookPath);
  take(["_rels/.rels", workbookPath, relsPath]);
  const head = readParts(bytes, (name) => name === workbookPath || name === relsPath, read);
  if (!head[workbookPath]) throw new Error("This file isn't an XLSX workbook: it has no workbook part.");
  const workbook = parseWorkbook(text(head[workbookPath]));
  const relationships = parseRelationships(text(head[relsPath]), workbookPath);
  const stringsPath = relationEndingIn(relationships, "/sharedStrings")?.target;
  const stylesPath = relationEndingIn(relationships, "/styles")?.target;

  const visible = workbook.sheets
    .map((sheet, index) => ({ ...sheet, number: index + 1 }))
    .filter((sheet) => sheet.state === "visible")
    .map((sheet) => ({ name: sheet.name, number: sheet.number, relation: relationships.get(sheet.relation) }))
    .filter((sheet) => sheet.relation && !sheet.relation.external && sheet.relation.type.endsWith("/worksheet"));
  take([stringsPath, stylesPath]);
  if (used > budget) throw new Error(tooLarge);
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
  const seen = new Set<string>();
  let index = 0;
  let stop: WorkbookSheets["stop"];
  for (; index < visible.length; index += 1) {
    if (sheets.length >= MAX_SHEETS) {
      stop = "sheets";
      break;
    }
    const path = visible[index]!.relation!.target;
    if (seen.has(path)) continue;
    seen.add(path);
    if (used + (sizes.get(path) ?? 0) > budget) {
      if (!sheets.length) throw new Error(tooLarge);
      stop = "size";
      break;
    }
    take([path]);
    const xml = text(readParts(bytes, (name) => name === path, read)[path]);
    const table = xml ? sheetTable(parseSheet(xml, context)) : null;
    if (table) sheets.push({ name: visible[index]!.name, number: visible[index]!.number, table });
  }
  return {
    sheets,
    hidden: workbook.sheets.filter((sheet) => sheet.state !== "visible").length,
    skipped: visible.length - index,
    ...(stop ? { stop } : {}),
  };
}

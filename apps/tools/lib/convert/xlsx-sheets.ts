// An XLSX workbook read as tables (issue #265), for XLSX to an image: each
// sheet a visitor would see in Excel, its cells as Excel shows them (numbers
// in their number format, dates as dates, formulas as their saved result),
// its first row as the header. Hidden and very hidden sheets, hidden rows
// and hidden columns are left out, as Excel leaves them out of a printout.
// Charts, pictures, comments and cell styles aren't read.
//
// Read with fflate (already the app's ZIP library) and a small XML scanner,
// on the main thread: a workbook part is inflated only when it's needed and
// only up to the size its ZIP entry declares, so a ZIP bomb can't fill the
// tab's memory.

import { unzipSync } from "fflate";

import { BUILT_IN_FORMATS, formatCellNumber } from "./excel-number-format.ts";
import type { TableData } from "./table-data.ts";

// A part bigger than this (inflated) isn't read: about 500,000 rows of ten
// columns.
export const MAX_PART_BYTES = 64 * 1024 * 1024;
// Rows and columns kept with their cells. An image shows far fewer (about
// 55 rows and 50 columns, table-image.ts); the rest are only counted.
export const KEPT_ROWS = 500;
export const KEPT_COLUMNS = 200;

export type Sheet = { name: string; table: TableData };

// ------------------------------------------------------------------ XML --

const XML_TOKEN =
  /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|([^<]+)/g;
const XML_ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#(\d+)|#x([0-9a-fA-F]+)|(lt|gt|amp|quot|apos));/g;
const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name] ?? whole;
    const code = decimal ? Number(decimal) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

// Excel writes characters XML can't hold as _xHHHH_ (and a literal
// "_x0041_" as "_x005F_x0041_").
export function decodeExcelEscapes(text: string): string {
  if (!text.includes("_x")) return text;
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

type XmlHandlers = {
  open?: (name: string, attributes: Record<string, string>, selfClosing: boolean) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
};

// Calls back for each element and text run, with local names (a prefix
// such as "x:" dropped) and attributes decoded.
export function scanXml(xml: string, { open, close, text }: XmlHandlers): void {
  XML_TOKEN.lastIndex = 0;
  for (let match = XML_TOKEN.exec(xml); match; match = XML_TOKEN.exec(xml)) {
    const [, slash, name, attributeText, selfClosing, cdata, run] = match;
    if (name !== undefined) {
      const local = localName(name);
      if (slash) {
        close?.(local);
        continue;
      }
      const attributes: Record<string, string> = {};
      if (open && attributeText) {
        XML_ATTRIBUTE.lastIndex = 0;
        for (let pair = XML_ATTRIBUTE.exec(attributeText); pair; pair = XML_ATTRIBUTE.exec(attributeText)) {
          attributes[localName(pair[1]!)] = decodeEntities(pair[2] ?? pair[3] ?? "");
        }
      }
      open?.(local, attributes, Boolean(selfClosing));
      if (selfClosing) close?.(local);
    } else if (cdata !== undefined) {
      text?.(cdata);
    } else if (run !== undefined) {
      text?.(decodeEntities(run));
    }
  }
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

// A part's relationships: id to target part path and type.
export function parseRelationships(xml: string, partPath: string): Map<string, { target: string; type: string }> {
  const base = partPath.slice(0, partPath.lastIndexOf("/") + 1);
  const relationships = new Map<string, { target: string; type: string }>();
  scanXml(xml, {
    open(name, attributes) {
      if (name !== "Relationship" || attributes.TargetMode === "External") return;
      relationships.set(attributes.Id ?? "", { target: resolvePart(base, attributes.Target ?? ""), type: attributes.Type ?? "" });
    },
  });
  return relationships;
}

// A relationship's target as a path in the ZIP: relative to the part's
// folder, or from the root when it starts with "/".
export function resolvePart(base: string, target: string): string {
  const segments = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
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
  let firstColumn = Infinity;
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
        firstColumn = Math.min(firstColumn, column);
        sheet.first.column = firstColumn;
        sheet.last = { row: rowIndex, column: Math.max(sheet.last.column, column) };
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

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function unzipParts(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  const tooBig: string[] = [];
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(bytes, {
      filter: (file) => {
        if (!wanted(file.name)) return false;
        if (file.originalSize > MAX_PART_BYTES) {
          tooBig.push(file.name);
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new Error("This XLSX file couldn't be read: it isn't a complete ZIP archive.");
  }
  if (tooBig.length) {
    throw new Error(
      `This workbook is too large to draw here: a sheet holds more than ${MAX_PART_BYTES / 1024 / 1024} MB of cells.`,
    );
  }
  return parts;
}

const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : "");

// The workbook's sheets that show, in order, as tables, and how many hidden
// sheets were left out; sheets with no values are left out too.
export function readWorkbookSheets(buf: ArrayBuffer): { sheets: Sheet[]; hidden: number } {
  const bytes = new Uint8Array(buf);
  if (OLE_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error(
      "This is an older Excel workbook (.xls) or a password-protected one: open it in Excel and save it as an unprotected .xlsx first.",
    );
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("This file isn't an XLSX workbook: it isn't a ZIP archive.");

  const root = unzipParts(bytes, (name) => name === "_rels/.rels");
  const office = [...parseRelationships(text(root["_rels/.rels"]), "").values()].find((relation) =>
    relation.type.endsWith("/officeDocument"),
  );
  const workbookPath = office?.target || "xl/workbook.xml";
  const relsPath = `${workbookPath.slice(0, workbookPath.lastIndexOf("/") + 1)}_rels/${workbookPath.slice(workbookPath.lastIndexOf("/") + 1)}.rels`;
  const head = unzipParts(bytes, (name) => name === workbookPath || name === relsPath);
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
  const paths = new Set([stringsPath, stylesPath, ...visible.map((sheet) => sheet.relation!.target)].filter(Boolean));
  const parts = unzipParts(bytes, (name) => paths.has(name));
  const context: CellContext = {
    strings: stringsPath ? parseSharedStrings(text(parts[stringsPath])) : [],
    formats: stylesPath ? parseStyles(text(parts[stylesPath])) : [],
    date1904: workbook.date1904,
  };
  const sheets: Sheet[] = [];
  for (const sheet of visible) {
    const xml = text(parts[sheet.relation!.target]);
    const table = xml ? sheetTable(parseSheet(xml, context)) : null;
    if (table) sheets.push({ name: sheet.name, table });
  }
  return { sheets, hidden: workbook.sheets.filter((sheet) => sheet.state !== "visible").length };
}

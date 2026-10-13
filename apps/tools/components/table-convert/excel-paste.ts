// A paste into a table converter's Excel input (#299 review). Excel puts two
// copies of copied cells on the clipboard: text, tab-separated, which keeps
// each cell's text exactly, and an HTML table. The input takes the text, but
// the text can read more than one way (a column of ditto marks copies as a
// quoted cell holding line breaks would, excel-cells.ts), and the HTML table
// says which: how many rows, how many cells each, and which cells hold a
// line break or a tab. The HTML is only scanned for that, as text: nothing
// is rendered, run or fetched.

import { readExcelCells, readPastedCells, writeExcelCells, writeExcelRows, type CopiedShape } from "../../lib/convert/excel-cells.ts";
import { excelTable, parseExcelCells, type TableData } from "../../lib/convert/table-data.ts";

// Clipboard HTML longer than this isn't scanned (about a million cells as
// Excel writes them); the text alone is read, as a visitor's.
const MAX_HTML = 128 * 1024 * 1024;
// A cell spanning more columns or rows than this (a merged cell) is one
// that no copy's text would match.
const MAX_SPAN = 16_384;

// Comments (Excel's conditional ones too), the columns Excel adds for
// browsers that misalign them, other markup declarations, raw text
// elements, and tags, their attribute values quoted or not.
const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<!\[if\s+supportMisalignedColumns\]>[\s\S]*?(?:<!\[endif\]>|$)|<![^>]*>|<(style|script|title|textarea)\b[\s\S]*?(?:<\/\1\s*>|$)|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const TAB_IN_TEXT = /\t|&#0*9;|&#x0*9;|&Tab;/i;
const BLANK = /^(?:\s|&nbsp;|&#160;)*$/i;
const QUOTE_FIRST = /^(?:\s|&nbsp;|&#160;)*(?:"|&quot;|&#0*34;|&#x0*22;)/i;

const span = (attributes: string, name: string) => {
  const value = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attributes)?.[1];
  return value ? Number(value) : 1;
};

// The first table in clipboard HTML, as the shape its cells have in the
// copy's text: a merged cell counts as every cell it covers, as Excel's text
// has them (its value in the first, the rest empty). Null when there's no
// table, or a table inside it, or a span past MAX_SPAN.
export function copiedShape(html: string): CopiedShape | null {
  if (html.length > MAX_HTML) return null;
  const widths: number[] = [];
  const quoted = new Set<string>();
  const quoteFirst = new Set<string>();
  // For each column, the rows below a cell spanning rows still covers.
  const covered: number[] = [];
  let inTable = false;
  let row: { column: number; covered: number } | null = null;
  // The cell being read, and whether its text has started.
  let cell: { key: string; started: boolean } | null = null;
  let last = 0;

  const startRow = () => {
    // Columns a cell above still covers are this row's too.
    let width = 0;
    covered.forEach((rows, column) => {
      if (rows > 0) width = column + 1;
    });
    row = { column: 0, covered: width };
  };
  const endRow = () => {
    if (!row) return;
    cell = null;
    widths.push(Math.max(row.column, row.covered));
    covered.forEach((rows, column) => {
      covered[column] = Math.max(0, rows - 1);
    });
    row = null;
  };

  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(html); match; match = TOKEN.exec(html)) {
    if (cell && match.index > last) {
      const text = html.slice(last, match.index);
      if (TAB_IN_TEXT.test(text)) quoted.add(cell.key);
      if (!cell.started && !BLANK.test(text)) {
        cell.started = true;
        if (QUOTE_FIRST.test(text)) quoteFirst.add(cell.key);
      }
    }
    last = TOKEN.lastIndex;
    const [, , closing, rawName, attributes = ""] = match;
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    if (name === "table") {
      if (closing) {
        if (inTable) break;
        continue;
      }
      if (inTable) return null;
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (name === "tr") {
      endRow();
      if (!closing) startRow();
    } else if (name === "td" || name === "th") {
      if (closing) {
        cell = null;
        continue;
      }
      if (!row) startRow();
      const current = row!;
      // The first column no cell above still covers.
      while ((covered[current.column] ?? 0) > 0) current.column += 1;
      const columns = span(attributes, "colspan");
      const rows = span(attributes, "rowspan");
      if (columns > MAX_SPAN || rows > MAX_SPAN) return null;
      cell = { key: `${widths.length}:${current.column}`, started: false };
      for (let column = current.column; column < current.column + Math.max(1, columns); column += 1) {
        if (rows > 1) covered[column] = rows;
      }
      current.column += Math.max(1, columns);
    } else if (name === "br" && cell) {
      quoted.add(cell.key);
    }
  }
  endRow();
  return inTable && widths.length ? { widths, quoted, quoteFirst } : null;
}

const sameTable = (a: TableData | null, b: TableData | null) => JSON.stringify(a) === JSON.stringify(b);

export type Paste = {
  // The clipboard's text and HTML (empty when there's none).
  plain: string;
  html: string;
  // The input's text and the selection the paste replaces.
  value: string;
  start: number;
  end: number;
  // Whether the page wrote the input's text (output-state.ts).
  written: boolean;
};

// What a paste into the Excel input leaves there: the input's text, where
// the caret goes, whether the page wrote it and whether it replaced all of
// the input; or null, and the browser pastes the text as it does anywhere.
//
// A paste over all of the input (or into an empty one) is the browser's own
// when the visitor's reading of its text (excel-cells.ts) is the copied
// table. When it isn't, the page puts the text in as the page's, which
// reads every quote that opens a cell as quoted: as copied, if that reads as
// the table, or else the table as the page writes it (a ditto mark as
// `""""`). Pasted into text the page wrote, cells copied with a quote are
// written the page's way too, so they read back as copied; a single cell
// pasted into another is pasted as it is.
export function excelPaste({ plain, html, value, start, end, written }: Paste): {
  value: string;
  caret: number;
  written: boolean;
  replacesInput: boolean;
} | null {
  // As a textarea takes it: every line break a \n.
  const text = plain.replace(/\r\n?/g, "\n");
  const shape = html ? copiedShape(html) : null;
  const copied = shape ? readPastedCells(text, shape) : null;
  if ((start === 0 && end === value.length) || !value.trim()) {
    if (!copied) return null;
    const table = excelTable(copied, true).table;
    if (!table || sameTable(parseExcelCells(text).table, table)) return null;
    const asWritten = sameTable(parseExcelCells(text, true).table, table) ? text : writeExcelCells(table);
    return { value: asWritten, caret: asWritten.length, written: true, replacesInput: true };
  }
  if (!written || !text.includes('"') || !/[\t\n]/.test(text)) return null;
  const rows = copied ?? readExcelCells(text, false);
  const insert = writeExcelRows(rows) + (text.endsWith("\n") ? "\n" : "");
  return { value: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length, written: true, replacesInput: false };
}

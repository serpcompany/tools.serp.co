// A table as the text Excel puts on the clipboard when cells are copied
// (issue #266): tab-separated, a row a line, and a cell in quotes, its quotes
// doubled, when it holds a tab or a line break, as Excel quotes; and here
// also when it holds a quote or a byte order mark, so text the page writes
// reads back exactly (readExcelCells).
// The table converters' Excel input holds a sheet as this text, so a sheet
// read from a workbook and cells pasted from Excel are one input, and
// parseExcelCells (table-data.ts) reads it back as the same table.
//
// No imports but a type: xlsx.worker.ts writes a sheet's text with this, and
// shouldn't load a CSV parser to do it.

import type { TableData } from "./table-data.ts";

// What a table converter reads from one workbook, at most, all its sheets
// together (readWorkbookSheets' `table` in xlsx-sheets.ts): TABLE_CELLS
// cells, empty ones included, and TABLE_CHARS characters of text, which is
// the sheets' text as written here, tabs, line breaks and quotes counted. A
// sheet that would take either past it, or that has a cell longer than Excel
// allows, is left out and named, so the text the worker sends and the page
// parses is bounded however long the workbook's strings are (a few KB of
// ZIP can repeat one 100 KB string in every cell). Measured in Chromium: a
// million cells of short numbers are 6.9 million characters and show in
// about 5 seconds; 9.6 million characters in 9,500 long cells, in 1.
export const TABLE_CELLS = 1_000_000;
export const TABLE_CHARS = 10_000_000;
// The most characters a cell holds in Excel. A longer one isn't from a
// workbook Excel saved, and its sheet isn't returned (xlsx-sheets.ts).
export const MAX_CELL_CHARS = 32_767;

// What the reader and the page say about a workbook older than XLSX: a
// binary .xls (an OLE file, as is a password-protected .xlsx) or the Excel
// 2003 XML a web app's "Export to Excel" may write (excel-input.ts).
export const OLD_WORKBOOK =
  "This is an older Excel workbook (.xls) or a password-protected one: open it in Excel and save it as an unprotected .xlsx first.";

const NEEDS_QUOTES = /[\t\n\r"\uFEFF]/;

const cellText = (cell: string) => (NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

// Rows of cells as the text below, a row a line.
export function writeExcelRows(rows: string[][]): string {
  return rows.map((row) => row.map(cellText).join("\t")).join("\n");
}

export function writeExcelCells(table: TableData): string {
  return writeExcelRows([table.headers, ...table.rows]);
}

// A cell's length as writeExcelCells writes it, without writing it.
export function excelCellSize(cell: string): number {
  if (!NEEDS_QUOTES.test(cell)) return cell.length;
  let quotes = 0;
  for (let index = cell.indexOf('"'); index >= 0; index = cell.indexOf('"', index + 1)) quotes += 1;
  return cell.length + quotes + 2;
}

const TAB = 9;
const LF = 10;
const CR = 13;
const QUOTE = 34;

// What makes a cell quoted when it's copied: a tab, a line break, a quote
// (doubled inside the quotes) or a byte order mark.
const QUOTED_FOR = /[\t\n\r\uFEFF]/;
// A quoted cell holding one of these ends somewhere else than the same text
// read as it stands: it holds a cell boundary.
const BOUNDARY = /[\t\n\r]/;
const LINE_BREAK = /[\n\r]/;

type Quoted = { value: string; end: number };

// A cell that starts with a quote is a quoted cell only when it is one as
// Excel writes it: its closing quote (one not doubled) ends the cell, before
// a tab, a line break or the end of the text, and it holds something that
// needed quoting. Its text, quotes undoubled, and where it ends; or null,
// and the cell is its text as it stands.
function quotedCell(text: string, start: number): Quoted | null {
  let doubled = false;
  for (let at = start + 1; ; ) {
    const quote = text.indexOf('"', at);
    if (quote < 0) return null;
    if (text.charCodeAt(quote + 1) === QUOTE) {
      doubled = true;
      at = quote + 2;
      continue;
    }
    const after = text.charCodeAt(quote + 1);
    if (quote + 1 < text.length && after !== TAB && after !== LF && after !== CR) return null;
    const inside = text.slice(start + 1, quote);
    if (!doubled && !QUOTED_FOR.test(inside)) return null;
    return { value: doubled ? inside.replaceAll('""', '"') : inside, end: quote + 1 };
  }
}

// Where the cell that starts at `at` ends, read as it stands: at the next
// tab or line break, or the end of the text.
function cellEnd(text: string, at: number): number {
  let end = at;
  for (let code = text.charCodeAt(end); end < text.length && code !== TAB && code !== LF && code !== CR; ) {
    end += 1;
    code = text.charCodeAt(end);
  }
  return end;
}

// Whether a cell that starts with a quote and can be read as a quoted cell
// is one, from that cell, where it starts, and its row and column.
type Take = (cell: Quoted, at: number, row: number, column: number) => boolean;

// Reads the text's cells in order, row by row: each cell that starts with a
// quote and can be quoted is quoted when `take` says so, and is its text as
// it stands otherwise. `cell` gets each cell, `rowEnd` each row's end. The
// line break after the last row isn't a row, and a byte order mark before
// the first cell isn't text.
function readCells(
  text: string,
  take: Take | null,
  cell: (at: number, end: number, quoted: Quoted | null) => void,
  rowEnd: () => void,
): void {
  let row = 0;
  let column = 0;
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    let quoted = take && text.charCodeAt(at) === QUOTE ? quotedCell(text, at) : null;
    if (quoted && !take!(quoted, at, row, column)) quoted = null;
    const end = quoted ? quoted.end : cellEnd(text, at);
    cell(at, end, quoted);
    column += 1;
    if (end >= text.length) break;
    const code = text.charCodeAt(end);
    at = end + 1;
    if (code === TAB) continue;
    if (code === CR && text.charCodeAt(at) === LF) at += 1;
    rowEnd();
    row += 1;
    column = 0;
    if (at >= text.length) return;
  }
  rowEnd();
}

function splitCells(text: string, take: Take | null): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  readCells(
    text,
    take,
    (at, end, quoted) => row.push(quoted ? quoted.value : text.slice(at, end)),
    () => {
      rows.push(row);
      row = [];
    },
  );
  return rows;
}

// Each row's cells in a reading, without building it.
function rowWidths(text: string, take: Take | null): number[] {
  const widths: number[] = [];
  let cells = 0;
  readCells(
    text,
    take,
    () => (cells += 1),
    () => {
      widths.push(cells);
      cells = 0;
    },
  );
  return widths;
}

const rectangular = (rows: string[][]) => rows.every((row) => row.length === rows[0]!.length);

const always: Take = () => true;
// Quoted cells that don't cross a line break: every line a row.
const withinLine = (cell: Quoted) => !LINE_BREAK.test(cell.value);
// Quoted cells that hold no tab or line break, whose cells are where they
// are in the text as it stands: a doubled quote or a byte order mark is all
// they were quoted for.
const inPlace = (cell: Quoted) => !BOUNDARY.test(cell.value);

// Cells as Excel puts them on the clipboard, or as writeExcelCells writes
// them, as rows of cells. Excel quotes a copied cell only when it holds a
// tab or a line break, so a cell that starts with a quote but isn't quoted
// the way Excel quotes (`"Best" seller`, `"Best"`, a ditto mark) is that
// text, quotes and all: no text is malformed.
//
// Text can read more than one way: a ditto mark `"` and a later cell that
// ends with a quote (another ditto mark below it, `14"` after it) copy as a
// quoted cell holding a tab or a line break would. Which reading is taken
// depends on who wrote the text:
// - `written`, text this page wrote (writeExcelCells: a sheet, a grid edit,
//   a table rewritten as Excel) quotes every cell that holds a quote, so a
//   cell that opens with a quote it can close is a quoted cell: it reads
//   back exactly. Should the visitor's edits leave that reading's rows of
//   different widths, and every cell as it stands doesn't, that is taken.
// - Otherwise the text is the visitor's (typed, pasted, a text file), and
//   rows are never merged on an ambiguous quote (readTypedCells).
export function readExcelCells(text: string, written: boolean): string[][] {
  if (!written) return readTypedCells(text);
  const read = splitCells(text, always);
  if (rectangular(read)) return read;
  const literal = splitCells(text, null);
  return rectangular(literal) ? literal : read;
}

// The visitor's text. Rows are merged on a quote only when no reading
// keeps every line a row of one width: first, each line is read with its
// quoted cells or as it stands, whichever keeps it as wide as the first
// line. Failing that (a cell really holds a line break), of the readings
// whose rows are all as wide as the table, the one that merges the fewest
// lines is taken (fewestMerged), the table's width being the most common
// row width when every quote is read as quoted, else the first line's.
// Excel copies a rectangle, and a cell it quoted for a line break leaves
// its lines shorter or longer than a row whenever the table has two or more
// columns, so that cell is merged and a ditto mark's row isn't. Text with no
// such reading (rows typed of different widths) keeps every line a row.
export function readTypedCells(text: string): string[][] {
  // Neither reading crosses a line break, so each has a row a line.
  const quoted = rowWidths(text, withinLine);
  const plain = rowWidths(text, inPlace);
  for (const width of new Set([quoted[0]!, plain[0]!])) {
    if (quoted.every((cells, line) => cells === width || plain[line] === width)) {
      return splitCells(text, (cell, _at, line) => (quoted[line] === width ? withinLine(cell) : inPlace(cell)));
    }
  }
  for (const width of new Set([commonWidth(rowWidths(text, always)), plain[0]!, quoted[0]!])) {
    const choices = fewestMerged(text, width);
    if (choices) return splitCells(text, (cell, at) => inPlace(cell) || choices.get(at) === true);
  }
  return splitCells(text, withinLine);
}

// The width most rows have (the first row's, on a tie).
function commonWidth(widths: number[]): number {
  const counts = new Map<number, number>();
  let best = widths[0]!;
  for (const width of widths) {
    const count = (counts.get(width) ?? 0) + 1;
    counts.set(width, count);
    if (count > counts.get(best)!) best = width;
  }
  return best;
}

function lineBreaks(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === LF || (code === CR && value.charCodeAt(index + 1) !== LF)) count += 1;
  }
  return count;
}

// A quoted cell's value that starts or ends with a tab or a line break, as
// a ditto mark read as the start or the end of a quoted cell gives: it
// counts against a reading that merges as many lines as another.
const edges = (value: string) => Number(BOUNDARY.test(value.charAt(0))) + Number(BOUNDARY.test(value.charAt(value.length - 1)));

// A cell that reads two ways (a quote that can open a quoted cell holding a
// tab or a line break), reached at `column` having merged `merged` lines,
// with `edges` quoted values that start or end with a tab or a line break,
// and the choice made at the one before it that led here.
type Branch = { at: number; column: number; merged: number; edges: number; cell: Quoted; parent: Branch | null; quoted: boolean };

// Past this many cells that read two ways, the search gives up.
const MAX_BRANCHES = 4_000_000;

// Of the readings whose rows are all `width` cells wide, the one that
// merges the fewest lines into rows (quoted cells holding line breaks), and
// of those the one with the fewest quoted values that start or end with a
// tab or a line break (as a ditto mark read as a quote gives): for
// each cell that reads two ways, whether it's read as quoted; null when no
// reading has rows that wide. A search over the cells that read two ways,
// in the text's order, each reached at a column with the fewest merged
// lines kept: one pass over the text for each column a cell can be reached
// at.
function fewestMerged(text: string, width: number): Map<number, boolean> | null {
  const heap: Branch[] = [];
  let best: { merged: number; edges: number; parent: Branch | null; quoted: boolean } | null = null;
  let branches = 0;

  const fewer = (a: { merged: number; edges: number }, b: { merged: number; edges: number }) =>
    a.merged < b.merged || (a.merged === b.merged && a.edges < b.edges);
  const before = (a: Branch, b: Branch) => a.at < b.at || (a.at === b.at && fewer(a, b));
  const push = (branch: Branch) => {
    branches += 1;
    let index = heap.push(branch) - 1;
    while (index > 0) {
      const up = (index - 1) >> 1;
      if (!before(heap[index]!, heap[up]!)) break;
      [heap[index], heap[up]] = [heap[up]!, heap[index]!];
      index = up;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let index = 0; ; ) {
        const left = 2 * index + 1;
        const right = left + 1;
        let next = index;
        if (left < heap.length && before(heap[left]!, heap[next]!)) next = left;
        if (right < heap.length && before(heap[right]!, heap[next]!)) next = right;
        if (next === index) break;
        [heap[index], heap[next]] = [heap[next]!, heap[index]!];
        index = next;
      }
    }
    return top;
  };

  // Reads on from the cell at `at`: that cell as `first` says (quoted, as it
  // stands, or however it reads when undefined), then every cell until one
  // that reads two ways, where a branch is pushed; or to the end of the
  // text, keeping the reading if it merges the fewest lines yet. A row of
  // any other width ends the reading.
  const scan = (at: number, column: number, merged: number, edged: number, parent: Branch | null, quoted: boolean, first?: Quoted | null) => {
    for (let decided = first !== undefined; ; decided = false) {
      let end: number;
      if (decided) {
        end = first ? first.end : cellEnd(text, at);
        if (first) {
          merged += lineBreaks(first.value);
          edged += edges(first.value);
        }
      } else {
        const cell = text.charCodeAt(at) === QUOTE ? quotedCell(text, at) : null;
        if (cell && !inPlace(cell)) {
          push({ at, column, merged, edges: edged, cell, parent, quoted });
          return;
        }
        end = cell ? cell.end : cellEnd(text, at);
      }
      column += 1;
      if (end < text.length && text.charCodeAt(end) === TAB) {
        if (column >= width) return;
        at = end + 1;
        continue;
      }
      if (column !== width) return;
      let next = end + 1;
      if (text.charCodeAt(end) === CR && text.charCodeAt(next) === LF) next += 1;
      if (next >= text.length) {
        const reading = { merged, edges: edged, parent, quoted };
        if (!best || fewer(reading, best)) best = reading;
        return;
      }
      at = next;
      column = 0;
    }
  };

  scan(text.charCodeAt(0) === 0xfeff ? 1 : 0, 0, 0, 0, null, false);
  // The cells already read from at this position, by column.
  let position = -1;
  const reached = new Set<number>();
  while (heap.length) {
    if (branches > MAX_BRANCHES) return null;
    const branch = pop();
    if (branch.at !== position) {
      position = branch.at;
      reached.clear();
    }
    if (reached.has(branch.column)) continue;
    reached.add(branch.column);
    scan(branch.at, branch.column, branch.merged, branch.edges, branch, true, branch.cell);
    scan(branch.at, branch.column, branch.merged, branch.edges, branch, false, null);
  }
  if (!best) return null;
  const choices = new Map<number, boolean>();
  let { parent, quoted } = best as { parent: Branch | null; quoted: boolean };
  for (; parent; parent = parent.parent) {
    choices.set(parent.at, quoted);
    quoted = parent.quoted;
  }
  return choices;
}

// Copied cells' shape, from the HTML table a spreadsheet puts on the
// clipboard next to the text (excel-paste.ts): each row's cells, the cells
// (`row:column`) that hold a tab or a line break, which the text quotes, and
// the cells whose text starts with a quote.
export type CopiedShape = { widths: number[]; quoted: Set<string>; quoteFirst: Set<string> };

// Cells pasted with the HTML table they were copied as, a reading taken
// only if its rows are that table's (null when none is). A cell that starts
// with a quote is quoted where the table says it holds a tab or a line
// break. One quoted for nothing else (a doubled quote, `"x""y"`) is quoted
// unless it's text Excel left as it stands: the table's cell starts with a
// quote and the quoted value doesn't.
export function readPastedCells(text: string, shape: CopiedShape): string[][] | null {
  const rows = splitCells(text, (cell, _at, row, column) => {
    const key = `${row}:${column}`;
    if (BOUNDARY.test(cell.value)) return shape.quoted.has(key);
    return !shape.quoteFirst.has(key) || cell.value.charCodeAt(0) === QUOTE;
  });
  const same = rows.length === shape.widths.length && rows.every((row, index) => row.length === shape.widths[index]);
  return same ? rows : null;
}

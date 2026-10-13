// An Excel workbook uploaded to a table converter (issue #266): whether a
// file is read as one, the workbook a read gives the page, and what the page
// says about it. The workbook is read in a worker by the XLSX reader that
// draws XLSX files as images (lib/convert/xlsx-sheets.ts, #265): hidden
// sheets, rows and columns left out, each cell as Excel shows it.

import { MAX_CELL_CHARS, OLD_WORKBOOK, TABLE_CELLS, TABLE_CHARS } from "../../lib/convert/excel-cells.ts";
import type { WorkbookText } from "../../lib/convert/xlsx.worker.ts";
import type { Workbook } from "./output-state.ts";
import type { InputFormat } from "./types.ts";

const formatCount = (value: number) => value.toLocaleString("en-US");
// What one upload reads at most (excel-cells.ts, xlsx-sheets.ts).
const LIMITS = `${formatCount(TABLE_CELLS)} cells and ${formatCount(TABLE_CHARS)} characters a workbook, ${formatCount(MAX_CELL_CHARS)} characters a cell`;

// A ZIP archive (an XLSX workbook is one) or an OLE file (an XLS workbook,
// or an XLSX saved with a password), by its first bytes.
const SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
];

const workbookBytes = (head: Uint8Array) => SIGNATURES.some((signature) => signature.every((byte, index) => head[index] === byte));

// A file is read as a workbook when its first bytes (`head`) are a
// workbook's and its name or type says Excel, or nothing does and the input
// is Excel; and an .xlsx file whatever it holds, so the reader can say what's
// wrong. Any other file is read as text: cells Excel saved as tab-delimited
// .txt, and an .xls that many web apps' "Export to Excel" write as
// tab-separated text or an HTML table (fileTextFormat). A real .xls (an OLE
// file) goes to the reader, which says it needs saving as .xlsx.
export function readsAsWorkbook(name: string, detected: InputFormat | null, inputFormat: InputFormat, head: Uint8Array): boolean {
  if (detected === "excel") return !/\.xls$/i.test(name) || workbookBytes(head);
  if (detected !== null || inputFormat !== "excel") return false;
  return workbookBytes(head);
}

// The format of a file read as text: the one its name or type says, except
// that an Excel file's text is an HTML table when it is one, and otherwise
// cells as Excel copies them (tab-separated). An Excel file in the Excel
// 2003 XML format (SpreadsheetML, which older "Export to Excel" features
// write as .xls) is refused as an older workbook is: its <Table> isn't an
// HTML table.
export function fileTextFormat(detected: InputFormat | null, text: string): InputFormat | null {
  if (detected !== "excel") return detected;
  if (/^\uFEFF?\s*<\?xml/i.test(text) && text.slice(0, 64 * 1024).includes("urn:schemas-microsoft-com:office:spreadsheet")) {
    throw new Error(OLD_WORKBOOK);
  }
  return /^\s*</.test(text) && /<table[\s>]/i.test(text) ? "html" : "excel";
}

const quoted = (names: string[]) => {
  const list = names.map((name) => `“${name}”`);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "");
};

// The workbook a read gives the page, or an Error saying why there's no
// sheet to show.
export function workbookInput(read: WorkbookText): Omit<Workbook, "sheet"> {
  if (!read.sheets.length) {
    if (read.tooLarge?.length) {
      throw new Error(`its sheets are larger than this page converts at once (${LIMITS}). Save the rows you need in a smaller workbook.`);
    }
    throw new Error("it has no visible sheet with values.");
  }
  return {
    sheets: read.sheets.map(({ name, text }) => ({ name, text })),
    hidden: read.hidden,
    skipped: read.skipped,
    ...(read.stop ? { stop: read.stop } : {}),
    tooLarge: read.tooLarge ?? [],
  };
}

// What the page says was left out of a workbook.
export function workbookNotes(workbook: Omit<Workbook, "sheet">): string[] {
  const notes: string[] = [];
  const { hidden, skipped, stop, tooLarge = [] } = workbook;
  if (tooLarge.length) {
    const one = tooLarge.length === 1;
    notes.push(`${quoted(tooLarge)} ${one ? "isn't" : "aren't"} shown: ${one ? "it's" : "they're"} larger than this page converts at once (${LIMITS}).`);
  }
  if (skipped) {
    const why = stop === "size" ? "the workbook holds more cells than one upload reads here" : "this page reads at most 100 sheets of a workbook";
    notes.push(`${skipped} more ${skipped === 1 ? "sheet isn't" : "sheets aren't"} read: ${why}.`);
  }
  if (hidden) notes.push(`${hidden} hidden ${hidden === 1 ? "sheet isn't" : "sheets aren't"} shown.`);
  return notes;
}

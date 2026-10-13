// An Excel workbook uploaded to a table converter (issue #266): whether a
// file is read as one, the workbook a read gives the page, and what the page
// says about it. The workbook is read in a worker by the XLSX reader that
// draws XLSX files as images (lib/convert/xlsx-sheets.ts, #265): hidden
// sheets, rows and columns left out, each cell as Excel shows it.

import { TABLE_CELLS } from "../../lib/convert/excel-cells.ts";
import type { WorkbookText } from "../../lib/convert/xlsx.worker.ts";
import type { Workbook } from "./output-state.ts";
import type { InputFormat } from "./types.ts";

const TABLE_CELLS_TEXT = TABLE_CELLS.toLocaleString("en-US");

// A ZIP archive (an XLSX workbook is one) or an OLE file (an XLS workbook,
// or an XLSX saved with a password), by its first bytes.
const SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
];

// A file is read as a workbook when its name or type says Excel, or when
// nothing does, the input is Excel and its first bytes (`head`) are a
// workbook's: a text file there, such as the cells Excel saves as
// tab-delimited text, is read as text. An XLS file is read as a workbook
// too, so the reader can say it needs saving as .xlsx.
export function readsAsWorkbook(detected: InputFormat | null, inputFormat: InputFormat, head: Uint8Array): boolean {
  if (detected === "excel") return true;
  if (detected !== null || inputFormat !== "excel") return false;
  return SIGNATURES.some((signature) => signature.every((byte, index) => head[index] === byte));
}

const quoted = (names: string[]) => {
  const list = names.map((name) => `“${name}”`);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "");
};

// The workbook a read gives the page, or an Error saying why there's no
// sheet to show.
export function workbookInput(read: WorkbookText): Omit<Workbook, "sheet"> {
  if (!read.sheets.length) {
    if (read.tooManyCells?.length) {
      throw new Error(
        `its sheets have more cells than this page converts at once (${TABLE_CELLS_TEXT}). Save the rows you need in a smaller workbook.`,
      );
    }
    throw new Error("it has no visible sheet with values.");
  }
  return {
    sheets: read.sheets.map(({ name, text }) => ({ name, text })),
    hidden: read.hidden,
    skipped: read.skipped,
    ...(read.stop ? { stop: read.stop } : {}),
    tooManyCells: read.tooManyCells ?? [],
  };
}

// What the page says was left out of a workbook.
export function workbookNotes(workbook: Omit<Workbook, "sheet">): string[] {
  const notes: string[] = [];
  const { hidden, skipped, stop, tooManyCells = [] } = workbook;
  if (tooManyCells.length) {
    const one = tooManyCells.length === 1;
    notes.push(
      `${quoted(tooManyCells)} ${one ? "isn't" : "aren't"} shown: ${one ? "it has" : "they have"} more cells than this page converts at once (${TABLE_CELLS_TEXT} in a workbook).`,
    );
  }
  if (skipped) {
    const why = stop === "size" ? "the workbook holds more cells than one upload reads here" : "this page reads at most 100 sheets of a workbook";
    notes.push(`${skipped} more ${skipped === 1 ? "sheet isn't" : "sheets aren't"} read: ${why}.`);
  }
  if (hidden) notes.push(`${hidden} hidden ${hidden === 1 ? "sheet isn't" : "sheets aren't"} shown.`);
  return notes;
}

import test from "node:test";
import assert from "node:assert/strict";

import { readsAsWorkbook, workbookInput, workbookNotes } from "./excel-input.ts";

test("a file is read as a workbook when its name or type says Excel, or its first bytes do on an Excel input", () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const text = new TextEncoder().encode("Name\tCount\n");
  // book.xlsx or book.xls, whatever it holds: the reader says what's wrong.
  assert.equal(readsAsWorkbook("excel", "csv", text), true);
  // A file with no extension the page knows, on an Excel input: a workbook
  // by its bytes, else text (cells Excel saved as tab-delimited .txt).
  assert.equal(readsAsWorkbook(null, "excel", zip), true);
  assert.equal(readsAsWorkbook(null, "excel", ole), true);
  assert.equal(readsAsWorkbook(null, "excel", text), false);
  assert.equal(readsAsWorkbook(null, "excel", new Uint8Array()), false);
  // On another input, or with an extension that says otherwise, it's text.
  assert.equal(readsAsWorkbook(null, "csv", zip), false);
  assert.equal(readsAsWorkbook("csv", "excel", zip), false);
});

test("a workbook with no sheet to show is a file that can't be read, and says why", () => {
  const read = { sheets: [], hidden: 2, skipped: 0, tooManyCells: [] };
  assert.throws(() => workbookInput(read), { message: "it has no visible sheet with values." });
  assert.throws(() => workbookInput({ ...read, tooManyCells: ["Data"] }), /more cells than this page converts at once \(1,000,000\)/);
  const sheets = [{ name: "Sales", number: 1, text: "a" }, { name: "Notes", number: 3, text: "b" }];
  assert.deepEqual(workbookInput({ ...read, sheets }), {
    sheets: [{ name: "Sales", text: "a" }, { name: "Notes", text: "b" }],
    hidden: 2,
    skipped: 0,
    tooManyCells: [],
  });
});

test("the page says what a workbook left out", () => {
  const sheets = [{ name: "Sales", text: "a" }];
  assert.deepEqual(workbookNotes({ sheets, hidden: 0, skipped: 0, tooManyCells: [] }), []);
  assert.deepEqual(workbookNotes({ sheets, hidden: 1, skipped: 0, tooManyCells: ["Log"] }), [
    "“Log” isn't shown: it has more cells than this page converts at once (1,000,000 in a workbook).",
    "1 hidden sheet isn't shown.",
  ]);
  assert.deepEqual(workbookNotes({ sheets, hidden: 3, skipped: 2, stop: "size", tooManyCells: ["A", "B", "C"] }), [
    "“A”, “B” and “C” aren't shown: they have more cells than this page converts at once (1,000,000 in a workbook).",
    "2 more sheets aren't read: the workbook holds more cells than one upload reads here.",
    "3 hidden sheets aren't shown.",
  ]);
  assert.deepEqual(workbookNotes({ sheets, hidden: 0, skipped: 1, stop: "sheets", tooManyCells: [] }), [
    "1 more sheet isn't read: this page reads at most 100 sheets of a workbook.",
  ]);
});

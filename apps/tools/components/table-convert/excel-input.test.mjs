import test from "node:test";
import assert from "node:assert/strict";

import { OLD_WORKBOOK } from "../../lib/convert/excel-cells.ts";
import { readWorkbookSheets } from "../../lib/convert/xlsx-sheets.ts";
import { fileTextFormat, readsAsWorkbook, workbookInput, workbookNotes } from "./excel-input.ts";

const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const text = new TextEncoder().encode("Name\tCount\n");

test("a file is read as a workbook when its first bytes are one and its name, its type or the Excel input says so", () => {
  // book.xlsx, whatever it holds: the reader says what's wrong.
  assert.equal(readsAsWorkbook("book.xlsx", "excel", "csv", text), true);
  // A file with no extension the page knows, on an Excel input: a workbook
  // by its bytes, else text (cells Excel saved as tab-delimited .txt).
  assert.equal(readsAsWorkbook("cells.txt", null, "excel", zip), true);
  assert.equal(readsAsWorkbook("cells.txt", null, "excel", ole), true);
  assert.equal(readsAsWorkbook("cells.txt", null, "excel", text), false);
  assert.equal(readsAsWorkbook("cells.txt", null, "excel", new Uint8Array()), false);
  // On another input, or with an extension that says otherwise, it's text.
  assert.equal(readsAsWorkbook("cells.txt", null, "csv", zip), false);
  assert.equal(readsAsWorkbook("data.csv", "csv", "excel", zip), false);
});

test("an .xls file is a workbook only by its bytes: a real one goes to the reader, text exported as .xls is read as text (#299 review)", () => {
  // A real .xls (OLE): the reader says to save it as .xlsx.
  assert.equal(readsAsWorkbook("old.xls", "excel", "csv", ole), true);
  assert.equal(readsAsWorkbook("OLD.XLS", "excel", "excel", ole), true);
  // An .xlsx named .xls is read as one.
  assert.equal(readsAsWorkbook("misnamed.xls", "excel", "csv", zip), true);
  // A web app's "Export to Excel": tab-separated text, or an HTML table.
  const html = new TextEncoder().encode("<html><body><table>");
  assert.equal(readsAsWorkbook("export.xls", "excel", "csv", text), false);
  assert.equal(readsAsWorkbook("export.xls", "excel", "excel", html), false);
  assert.equal(fileTextFormat("excel", "Name\tCount\r\nAlpha\t1\r\n"), "excel");
  assert.equal(fileTextFormat("excel", '\uFEFF\n <html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><TABLE border=1><tr><td>a</td></tr></TABLE>'), "html");
  // Cells that merely mention a table are still cells.
  assert.equal(fileTextFormat("excel", "Tag\tUse\r\n<table>\tlayout\r\n"), "excel");
  assert.equal(fileTextFormat("excel", "<b>bold</b>\tx"), "excel");
  // Any other file's text is in the format its name or type says, or the input's.
  assert.equal(fileTextFormat("csv", "<table>"), "csv");
  assert.equal(fileTextFormat(null, "a\tb"), null);
});

test("an .xls in the Excel 2003 XML format is refused as an older workbook is, not read as an empty HTML table (#299 review)", () => {
  const spreadsheetML =
    '<?xml version="1.0"?>\r\n<?mso-application progid="Excel.Sheet"?>\r\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Worksheet ss:Name="Sheet1"><Table><Row><Cell><Data ss:Type="String">Name</Data></Cell></Row></Table></Worksheet></Workbook>';
  assert.throws(() => fileTextFormat("excel", spreadsheetML), (error) => error.message === OLD_WORKBOOK);
  assert.match(OLD_WORKBOOK, /save it as an unprotected \.xlsx/);
  // The same message as a binary .xls gets from the reader.
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]).buffer;
  assert.throws(() => readWorkbookSheets(ole), (error) => error.message === OLD_WORKBOOK);
  // Excel's own HTML export, and XML that isn't a workbook, aren't refused.
  assert.equal(fileTextFormat("excel", '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><table><tr><td>a</td></tr></table>'), "html");
  assert.equal(fileTextFormat("excel", '<?xml version="1.0"?>\n<rows><row>a</row></rows>'), "excel");
});

test("a workbook with no sheet to show is a file that can't be read, and says why", () => {
  const read = { sheets: [], hidden: 2, skipped: 0, tooLarge: [] };
  assert.throws(() => workbookInput(read), { message: "it has no visible sheet with values." });
  assert.throws(() => workbookInput({ ...read, tooLarge: ["Data"] }), {
    message:
      "its sheets are larger than this page converts at once (1,000,000 cells and 10,000,000 characters a workbook, 32,767 characters a cell). Save the rows you need in a smaller workbook.",
  });
  const sheets = [{ name: "Sales", number: 1, text: "a" }, { name: "Notes", number: 3, text: "b" }];
  assert.deepEqual(workbookInput({ ...read, sheets }), {
    sheets: [{ name: "Sales", text: "a" }, { name: "Notes", text: "b" }],
    hidden: 2,
    skipped: 0,
    tooLarge: [],
  });
});

test("the page says what a workbook left out", () => {
  const sheets = [{ name: "Sales", text: "a" }];
  const limits = "(1,000,000 cells and 10,000,000 characters a workbook, 32,767 characters a cell)";
  assert.deepEqual(workbookNotes({ sheets, hidden: 0, skipped: 0, tooLarge: [] }), []);
  assert.deepEqual(workbookNotes({ sheets, hidden: 1, skipped: 0, tooLarge: ["Log"] }), [
    `“Log” isn't shown: it's larger than this page converts at once ${limits}.`,
    "1 hidden sheet isn't shown.",
  ]);
  assert.deepEqual(workbookNotes({ sheets, hidden: 3, skipped: 2, stop: "size", tooLarge: ["A", "B", "C"] }), [
    `“A”, “B” and “C” aren't shown: they're larger than this page converts at once ${limits}.`,
    "2 more sheets aren't read: the workbook holds more cells than one upload reads here.",
    "3 hidden sheets aren't shown.",
  ]);
  assert.deepEqual(workbookNotes({ sheets, hidden: 0, skipped: 1, stop: "sheets", tooLarge: [] }), [
    "1 more sheet isn't read: this page reads at most 100 sheets of a workbook.",
  ]);
});

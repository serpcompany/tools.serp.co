import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

import { layoutTableImage } from "./table-image.ts";
import {
  KEPT_COLUMNS,
  KEPT_ROWS,
  MAX_PART_BYTES,
  MAX_SHEETS,
  cellPosition,
  decodeExcelEscapes,
  parseSharedStrings,
  parseSheet,
  parseStyles,
  readWorkbookSheets,
  sheetTable,
} from "./xlsx-sheets.ts";
import { resolvePart } from "./ooxml.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// A workbook of `sheets` ({ name, xml, state?, chart? }), with shared
// strings and styles, zipped as Excel does.
function workbook(sheets, { strings = [], styles = "" } = {}) {
  const files = {
    "[Content_Types].xml": "<Types/>",
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook ${NS}><sheets>${sheets
      .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}"${sheet.state ? ` state="${sheet.state}"` : ""} r:id="rId${index + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (sheet, index) =>
          `<Relationship Id="rId${index + 1}" Type="${REL}/${sheet.chart ? "chartsheet" : "worksheet"}" Target="${sheet.chart ? "chartsheets" : "worksheets"}/sheet${index + 1}.xml"/>`,
      )
      .join("")}<Relationship Id="rS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rT" Type="${REL}/styles" Target="/xl/styles.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst ${NS}>${strings.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`,
    "xl/styles.xml": styles || `<styleSheet ${NS}><cellXfs><xf numFmtId="0"/></cellXfs></styleSheet>`,
  };
  sheets.forEach((sheet, index) => {
    files[`xl/${sheet.chart ? "chartsheets" : "worksheets"}/sheet${index + 1}.xml`] = sheet.xml;
  });
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

const worksheet = (rows, extra = "") => `<worksheet ${NS}>${extra}<sheetData>${rows}</sheetData></worksheet>`;
const context = { strings: [], formats: ["General"], date1904: false };

test("cell references, part paths and Excel's escapes", () => {
  assert.deepEqual(cellPosition("A1"), { row: 0, column: 0 });
  assert.deepEqual(cellPosition("AB12"), { row: 11, column: 27 });
  assert.deepEqual(cellPosition("$C$3"), { row: 2, column: 2 });
  assert.equal(cellPosition("nope"), null);
  assert.equal(resolvePart("xl/", "worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
  assert.equal(resolvePart("xl/", "/xl/styles.xml"), "xl/styles.xml");
  assert.equal(resolvePart("xl/worksheets/", "../drawings/d.xml"), "xl/drawings/d.xml");
  assert.equal(decodeExcelEscapes("a_x000D_b_x005F_x0041_"), "a\rb_x0041_");
});

test("shared strings join rich text runs and leave out phonetic guides", () => {
  const xml = `<sst ${NS}><si><t>plain &amp; simple</t></si><si><r><rPr><b/></rPr><t>bold</t></r><r><t xml:space="preserve"> and not</t></r></si><si><t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh></si><si><t/></si></sst>`;
  assert.deepEqual(parseSharedStrings(xml), ["plain & simple", "bold and not", "漢字", ""]);
});

test("styles give each cell style's number format, custom or built in", () => {
  const xml = `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellStyleXfs><xf numFmtId="10"/></cellStyleXfs><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="10"/><xf numFmtId="3"/></cellXfs></styleSheet>`;
  assert.deepEqual(parseStyles(xml), ["General", "yyyy-mm-dd", "0.00%", "#,##0"]);
});

test("cells show as Excel shows them: strings, numbers in their format, booleans, errors, formula results", () => {
  const cells = parseSheet(
    worksheet(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>inline</t></is></c><c r="C1" t="b"><v>1</v></c><c r="D1" t="e"><v>#DIV/0!</v></c></row>` +
        `<row r="2"><c r="A2" s="1"><v>46095</v></c><c r="B2" s="2"><v>0.125</v></c><c r="C2"><f>SUM(1,2)</f><v>3</v></c><c r="D2" t="str"><f>"a"&amp;"b"</f><v>ab</v></c></row>`,
    ),
    { strings: ["shared"], formats: ["General", "m/d/yyyy", "0.0%"], date1904: false },
  );
  assert.deepEqual(sheetTable(cells), {
    headers: ["shared", "inline", "TRUE", "#DIV/0!"],
    rows: [["3/14/2026", "12.5%", "3", "ab"]],
  });
});

test("hidden rows and columns are left out, and the table starts at the first value", () => {
  const cells = parseSheet(
    worksheet(
      `<row r="3"><c r="B3" t="inlineStr"><is><t>name</t></is></c><c r="C3" t="inlineStr"><is><t>secret</t></is></c><c r="D3" t="inlineStr"><is><t>count</t></is></c></row>` +
        `<row r="4"><c r="B4" t="inlineStr"><is><t>Alpha</t></is></c><c r="C4"><v>99</v></c><c r="D4"><v>1</v></c></row>` +
        `<row r="5" hidden="1"><c r="B5" t="inlineStr"><is><t>Hidden</t></is></c><c r="D5"><v>7</v></c></row>` +
        `<row r="7"><c r="B7" t="inlineStr"><is><t>Beta</t></is></c><c r="D7"><v>2</v></c></row>`,
      `<cols><col min="3" max="3" hidden="1" width="0"/></cols>`,
    ),
    context,
  );
  // Row 6 is empty but shows; row 5 is hidden; column C is hidden.
  assert.deepEqual(sheetTable(cells), {
    headers: ["name", "count"],
    rows: [["Alpha", "1"], ["", ""], ["Beta", "2"]],
  });
});

test("with zeroHeight, rows the sheet doesn't list are hidden", () => {
  const cells = parseSheet(
    worksheet(
      `<row r="1"><c r="A1"><v>1</v></c></row><row r="3"><c r="A3"><v>3</v></c></row>`,
      `<sheetFormatPr defaultRowHeight="15" zeroHeight="1"/>`,
    ),
    context,
  );
  assert.deepEqual(sheetTable(cells), { headers: ["1"], rows: [["3"]] });
});

test("a sheet with no values has no table", () => {
  assert.equal(sheetTable(parseSheet(worksheet(`<row r="1"><c r="A1" s="0"/><c r="B1"><v></v></c></row>`), context)), null);
});

test("hidden sheets, chart sheets and empty sheets aren't drawn; the rest keep the workbook's order", () => {
  const cell = (text) => worksheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row>`);
  const { sheets, hidden } = readWorkbookSheets(
    workbook([
      { name: "Summary", xml: cell("first") },
      { name: "Salaries", xml: cell("secret"), state: "hidden" },
      { name: "Macros", xml: cell("very secret"), state: "veryHidden" },
      { name: "Chart", xml: "<chartsheet/>", chart: true },
      { name: "Empty", xml: worksheet("") },
      { name: "Detail", xml: cell("second") },
    ]),
  );
  assert.deepEqual(
    sheets.map((sheet) => [sheet.name, sheet.table.headers[0]]),
    [
      ["Summary", "first"],
      ["Detail", "second"],
    ],
  );
  assert.equal(hidden, 2);
});

test("a workbook gives at most MAX_SHEETS images, and counts the rest", () => {
  const cell = (text) => worksheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row>`);
  const sheets = Array.from({ length: MAX_SHEETS + 3 }, (_, index) => ({ name: `S${index + 1}`, xml: cell(`v${index + 1}`) }));
  const result = readWorkbookSheets(workbook(sheets));
  assert.equal(result.sheets.length, MAX_SHEETS);
  assert.equal(result.sheets.at(-1).name, `S${MAX_SHEETS}`);
  assert.equal(result.skipped, 3);
});

test("the committed XLSX fixtures read back", () => {
  const read = (name) => {
    const bytes = readFileSync(path.join(fixtures, name));
    return readWorkbookSheets(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  const sample = read("sample.xlsx");
  assert.deepEqual(sample.sheets.map((sheet) => sheet.table), [{ headers: ["name", "count"], rows: [["Alpha", "1"], ["Beta", "2"]] }]);
  // Its hidden sheet, hidden row and hidden column don't show.
  const sheets = read("sample-sheets.xlsx");
  assert.equal(sheets.hidden, 1);
  assert.deepEqual(
    sheets.sheets.map((sheet) => sheet.name),
    ["Sales", "Notes"],
  );
  assert.deepEqual(sheets.sheets[0].table, {
    headers: ["Region", "Date", "Units", "Revenue", "Share", "On target"],
    rows: [
      ["North", "3/14/2026", "1,200", "$15,234.50", "25%", "TRUE"],
      ["South", "3/15/2026", "3,400", "$42,000.00", "50%", "TRUE"],
      ["East", "3/16/2026", "987", "$9,870.25", "13%", "FALSE"],
      ["Total", "", "5,588", "$67,105.75", "", ""],
    ],
  });
  assert.deepEqual(sheets.sheets[1].table.rows.at(-1), ["Arabic", "مرحبا بالعالم"]);
  assert.ok(!JSON.stringify(sheets).includes("secret") && !JSON.stringify(sheets).includes("Hidden"));
});

test("10,000 rows in three sheets read quickly; the image counts every row but keeps only those it can show", () => {
  const rows = Array.from(
    { length: 10_000 },
    (_, index) =>
      `<row r="${index + 1}">${Array.from({ length: 8 }, (_, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}"><v>${index * 8 + column}</v></c>`).join("")}</row>`,
  ).join("");
  const started = performance.now();
  const { sheets } = readWorkbookSheets(
    workbook([
      { name: "One", xml: worksheet(rows) },
      { name: "Two", xml: worksheet(rows) },
      { name: "Three", xml: worksheet(rows) },
    ]),
  );
  assert.ok(performance.now() - started < 5000, `${performance.now() - started} ms`);
  assert.equal(sheets.length, 3);
  const { table } = sheets[0];
  assert.equal(table.rows.length, 9_999);
  assert.deepEqual(table.rows[0], ["8", "9", "10", "11", "12", "13", "14", "15"]);
  // KEPT_ROWS rows with values, the header among them.
  assert.equal(table.rows[KEPT_ROWS - 2]?.length, 8);
  assert.equal(table.rows[KEPT_ROWS - 1], undefined);
  assert.equal(table.rows[KEPT_ROWS + 10], undefined);
  const layout = layoutTableImage(table, (text) => text.length * 7);
  assert.match(layout.note, /^Showing the first \d+ of 9,999 rows\.$/);
});

test("a very wide sheet keeps its first columns and counts the rest", () => {
  const cells = Array.from({ length: 1000 }, (_, column) => `<c><v>${column}</v></c>`).join("");
  const table = sheetTable(parseSheet(worksheet(`<row r="1">${cells}</row><row r="2">${cells}</row>`), context));
  assert.equal(table.headers.length, 1000);
  assert.equal(table.rows[0].length, KEPT_COLUMNS);
  const layout = layoutTableImage(table, (text) => text.length * 7);
  assert.match(layout.note, /of 1,000 columns\.$/);
});

test("old XLS files, broken files and parts bigger than the limit are refused", () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]).buffer;
  assert.throws(() => readWorkbookSheets(ole), /older Excel workbook \(\.xls\) or a password-protected one/);
  assert.throws(() => readWorkbookSheets(strToU8("name,count\n").buffer), /isn't a ZIP archive/);
  assert.throws(() => readWorkbookSheets(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]).buffer), /isn't a complete ZIP archive/);

  // A sheet whose ZIP entry says it inflates past the limit isn't inflated.
  const bytes = new Uint8Array(workbook([{ name: "Big", xml: worksheet(`<row r="1"><c><v>1</v></c></row>`) }]));
  const view = new DataView(bytes.buffer);
  const name = new TextEncoder().encode("xl/worksheets/sheet1.xml");
  for (let offset = 0; offset < bytes.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const length = view.getUint16(offset + 28, true);
    const entry = bytes.subarray(offset + 46, offset + 46 + length);
    if (entry.length === name.length && entry.every((byte, index) => byte === name[index])) {
      view.setUint32(offset + 24, MAX_PART_BYTES + 1, true);
    }
  }
  assert.throws(() => readWorkbookSheets(bytes.buffer), /too large to draw here/);
});

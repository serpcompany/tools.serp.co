import test from "node:test";
import assert from "node:assert/strict";

import { outputFileName } from "./formats.ts";
import { canOfferOutput, initialTablePage, offeredDownload, tablePageReducer } from "./output-state.ts";

// A small stand-in for convert.ts: text is `<format>:<cell>|<cell>…`, one
// column. Text in another format, with BROKEN in it, or empty doesn't parse.
// Every input format, Excel's included (cells as Excel copies them, #266),
// is parsed and written as text, as on the page.
function parse(format, text) {
  if (!text.trim()) return { table: null, supported: true, error: "Paste or upload data to begin." };
  if (!text.startsWith(`${format}:`)) return { table: null, supported: true, error: `This isn't ${format}.` };
  const body = text.slice(format.length + 1);
  if (body.includes("BROKEN")) return { table: null, supported: true, error: "Unclosed quote." };
  return { table: { headers: ["value"], rows: body.split("|").map((cell) => [cell]) }, supported: true };
}
function serialize(format, table) {
  return { text: `${format}:${table.rows.map((row) => row[0]).join("|")}`, supported: true };
}
const placeholder = { headers: ["Column 1"], rows: [[""]] };
const next = tablePageReducer({ parse, serialize, placeholder });
const start = (format = "csv") => initialTablePage(format, placeholder);
const run = (state, ...events) => events.reduce(next, state);
const cells = (state) => state.table?.rows.map((row) => row[0]) ?? null;

// a.csv chosen and read.
function afterA() {
  return run(start(), { type: "upload", name: "a.csv", ticket: 1 }, { type: "read", ticket: 1, text: "csv:AAA_FIRST", format: "csv" });
}

test("a file's table and name arrive together; a read that finishes after a newer upload is dropped", () => {
  let state = run(start(), { type: "upload", name: "a.csv", ticket: 1 }, { type: "upload", name: "b.csv", ticket: 2 });
  // a.csv's read finishes late: b.csv is still being read, and nothing changes.
  assert.equal(next(state, { type: "read", ticket: 1, text: "csv:AAA_FIRST", format: "csv" }), state);
  state = next(state, { type: "read", ticket: 2, text: "csv:BBB_SECOND", format: "csv" });
  assert.deepEqual(cells(state), ["BBB_SECOND"]);
  assert.equal(state.fileName, "b.csv");
  assert.equal(state.upload, null);
});

test("typing, a grid edit or a clear during a read wins over it", () => {
  const a = afterA();
  const choosingB = next(a, { type: "upload", name: "b.csv", ticket: 2 });
  // While b.csv is read, a.csv's table and name stay (and nothing is offered).
  assert.equal(choosingB.fileName, "a.csv");
  const lateB = { type: "read", ticket: 2, text: "csv:BBB_SLOW", format: "csv" };
  // Typing over a.csv's table keeps a.csv's name; b.csv's late read is dropped.
  const typed = next(choosingB, { type: "type", text: "csv:TYPED" });
  assert.deepEqual([typed.fileName, typed.upload, cells(typed)], ["a.csv", null, ["TYPED"]]);
  assert.equal(next(typed, lateB), typed);
  const edited = next(choosingB, { type: "editGrid", table: { headers: ["value"], rows: [["EDITED"]] }, origin: a.origin });
  assert.deepEqual([edited.fileName, edited.upload, edited.inputText], ["a.csv", null, "csv:EDITED"]);
  assert.equal(next(edited, lateB), edited);
  const cleared = next(choosingB, { type: "clear" });
  assert.deepEqual([cleared.fileName, cleared.upload, cleared.table], [null, null, placeholder]);
  assert.equal(next(cleared, lateB), cleared);
});

test("a read or parse that fails clears the table, but the input's text keeps its origin", () => {
  const a = afterA();
  // b.csv couldn't be read: a.csv's text is still in the input, so its name
  // stays, but there's no table, and nothing is offered.
  const unreadable = run(a, { type: "upload", name: "b.csv", ticket: 2 }, { type: "readFailed", ticket: 2, error: "b.csv couldn't be read" });
  assert.deepEqual([unreadable.table, unreadable.fileName, unreadable.error], [null, "a.csv", "b.csv couldn't be read"]);
  assert.equal(offeredDownload(unreadable, "json", { table: a.table, format: "json" }), null);
  // Editing a.csv's text afterwards is still a.csv's; never b.csv's.
  const typed = next(unreadable, { type: "type", text: "csv:AAA_FIRST|EDITED" });
  assert.deepEqual([cells(typed), typed.fileName], [["AAA_FIRST", "EDITED"], "a.csv"]);
  // Typing that stops parsing drops the table, not the name.
  const broken = next(a, { type: "type", text: "csv:AAA BROKEN" });
  assert.deepEqual([broken.table, broken.fileName], [null, "a.csv"]);
  // A failed first upload leaves no name; the same file chosen again is read.
  const failedFirst = run(start(), { type: "upload", name: "b.csv", ticket: 1 }, { type: "readFailed", ticket: 1, error: "gone" });
  assert.equal(failedFirst.fileName, null);
  const retried = run(failedFirst, { type: "upload", name: "b.csv", ticket: 2 }, { type: "read", ticket: 2, text: "csv:BBB", format: "csv" });
  assert.deepEqual([retried.fileName, retried.error, cells(retried)], ["b.csv", null, ["BBB"]]);
  // Clearing drops the name.
  assert.equal(next(a, { type: "clear" }).fileName, null);
});

test("round 4: the name follows the input's text: a typo and its fix keep the file's name, a paste over all of it is table.<ext>", () => {
  // data.json uploaded on JSON to Markdown.
  const data = run(start("json"), { type: "upload", name: "data.json", ticket: 1 }, { type: "read", ticket: 1, text: "json:R1|R2|R3", format: "json" });
  const download = (state) => offeredDownload(state, "markdown", state.table ? { table: state.table, format: "markdown" } : null);
  assert.equal(download(data).name, "data.md");
  // A row typed in: the first keystrokes don't parse, so nothing is offered...
  const typo = next(data, { type: "type", text: "json:R1|R2|R3 BROKEN" });
  assert.deepEqual([typo.table, typo.fileName, download(typo)], [null, "data.json", null]);
  // ...and once it parses again, the download is still named after data.json.
  const fixed = next(typo, { type: "type", text: "json:R1|R2|R3|R4" });
  assert.deepEqual([cells(fixed), download(fixed).name], [["R1", "R2", "R3", "R4"], "data.md"]);
  // A grid edit and another input format edit the same text, and keep it.
  const edited = next(fixed, { type: "editGrid", table: { headers: ["value"], rows: [["R1"], ["G1"]] }, origin: fixed.origin });
  assert.deepEqual([edited.inputText, edited.fileName], ["json:R1|G1", "data.json"]);
  const asCsv = next(edited, { type: "inputFormat", format: "csv" });
  assert.deepEqual([asCsv.inputText, download(asCsv).name], ["csv:R1|G1", "data.md"]);
  // A paste over the whole input is the visitor's own text: table.md.
  const pasted = next(fixed, { type: "type", text: "json:P1|P2", replacesInput: true });
  assert.deepEqual([cells(pasted), pasted.fileName, download(pasted).name], [["P1", "P2"], null, "table.md"]);
  // So is text typed into an input emptied a character at a time.
  const emptied = next(fixed, { type: "type", text: "" });
  assert.deepEqual([emptied.table, emptied.fileName], [null, "data.json"]);
  const retyped = next(emptied, { type: "type", text: "json:T1" });
  assert.deepEqual([cells(retyped), download(retyped).name], [["T1"], "table.md"]);
  // A paste that replaces only part of the text edits it: still data.json's.
  const partial = next(fixed, { type: "type", text: "json:R1|R2|R3|R4|P1" });
  assert.equal(download(partial).name, "data.md");
});

test("round 3: a new upload that doesn't read or parse never lends its name to the previous table", () => {
  const a = afterA();
  const b = run(a, { type: "upload", name: "b.json", ticket: 2 }, { type: "read", ticket: 2, text: 'json:{"name": "BBB_ BROKEN', format: "json" });
  // b.json's text is in the input, so it's b.json's, but there's no table.
  assert.deepEqual([b.table, b.fileName, b.error], [null, "b.json", "Unclosed quote."]);
  // The grid still showing a.csv's table reports a.csv's origin: dropped.
  const edit = { type: "editGrid", table: { headers: ["value"], rows: [["EDITED"]] }, origin: a.origin };
  assert.equal(next(b, edit), b);
  // b.json's text, fixed by typing, is b.json's table.
  const fixedB = next(b, { type: "type", text: 'json:{"name": "BBB_"}' });
  assert.deepEqual([cells(fixedB), fixedB.fileName], [['{"name": "BBB_"}'], "b.json"]);
  // b.csv that can't be read: a.csv's text stays, under a.csv's name.
  const unreadable = run(a, { type: "upload", name: "b.csv", ticket: 4 }, { type: "readFailed", ticket: 4, error: "gone" });
  assert.deepEqual([unreadable.inputText, unreadable.fileName], ["csv:AAA_FIRST", "a.csv"]);
  assert.equal(next(unreadable, { ...edit, origin: unreadable.origin }), unreadable, "no table, so no edit");
  // b.json as the first upload: the placeholder's grid can't be edited into b.json either.
  const first = run(start("json"), { type: "upload", name: "b.json", ticket: 1 }, { type: "read", ticket: 1, text: "json:BROKEN", format: "json" });
  assert.equal(next(first, { ...edit, origin: 0 }), first);
  // A grid edit made on a.csv's table after b.csv replaced it is dropped too.
  const replaced = run(a, { type: "upload", name: "b.csv", ticket: 3 }, { type: "read", ticket: 3, text: "csv:BBB", format: "csv" });
  assert.equal(next(replaced, edit), replaced);
  assert.equal(next(replaced, { ...edit, origin: replaced.origin }).fileName, "b.csv");
});

test("round 2: an input the page can't read isn't rewritten from the previous table when the input format changes", () => {
  // a.csv, then b.json that isn't JSON (round 2's was an XLSX read as text,
  // before #266 read workbooks): no table; b.json's text is in the input,
  // so the name is b.json's.
  const b = run(afterA(), { type: "upload", name: "b.json", ticket: 2 }, { type: "read", ticket: 2, text: "PK\u0003\u0004", format: "json" });
  assert.deepEqual([b.table, b.fileName], [null, "b.json"]);
  // CSV picked: b.json's text is parsed as CSV, never a.csv's table.
  const asCsv = next(b, { type: "inputFormat", format: "csv" });
  assert.deepEqual([asCsv.inputText, asCsv.table, asCsv.fileName], ["PK\u0003\u0004", null, "b.json"]);
  // b.json holding CSV text parses once CSV is picked, under its own name.
  // (Round 3 needed an exception for this; now it is the text's origin.)
  const csvText = run(afterA(), { type: "upload", name: "b.json", ticket: 2 }, { type: "read", ticket: 2, text: "csv:BBB_SECOND", format: "json" });
  const picked = next(csvText, { type: "inputFormat", format: "csv" });
  assert.deepEqual([cells(picked), picked.fileName], [["BBB_SECOND"], "b.json"]);
  // b.json as the first upload: the placeholder isn't written into the input.
  const first = run(start(), { type: "upload", name: "b.json", ticket: 1 }, { type: "read", ticket: 1, text: "PK", format: "json" });
  const firstCsv = next(first, { type: "inputFormat", format: "csv" });
  assert.deepEqual([firstCsv.inputText, firstCsv.table, firstCsv.fileName], ["PK", null, "b.json"]);
  // A table on screen is rewritten in the new format and keeps its name.
  const json = next(afterA(), { type: "inputFormat", format: "json" });
  assert.deepEqual([json.inputText, cells(json), json.fileName], ["json:AAA_FIRST", ["AAA_FIRST"], "a.csv"]);
});

// An Excel workbook (#266), read in a worker into each sheet's text.
const book = (prefix, count = 2, extra = {}) => ({
  sheets: Array.from({ length: count }, (_, index) => ({ name: `Sheet${index + 1}`, text: `excel:${prefix}${index + 1}a|${prefix}${index + 1}b` })),
  hidden: 1,
  skipped: 0,
  tooManyCells: [],
  ...extra,
});

test("a workbook's first sheet arrives as an Excel input under the file's name; another sheet replaces it under the same name", () => {
  const sheets = book("S", 3);
  const read = run(afterA(), { type: "upload", name: "book.xlsx", ticket: 2 }, { type: "readWorkbook", ticket: 2, workbook: sheets });
  assert.deepEqual([read.inputFormat, read.inputText, read.fileName, read.workbook.sheet, read.workbook.sheets], ["excel", "excel:S1a|S1b", "book.xlsx", 0, sheets.sheets]);
  assert.equal(offeredDownload(read, "csv", { table: read.table, format: "csv" }).name, "book.csv");
  const second = next(read, { type: "sheet", sheet: 1 });
  assert.deepEqual([cells(second), second.fileName, second.workbook.sheet], [["S2a", "S2b"], "book.xlsx", 1]);
  // A table afresh: the grid's edit of the first sheet's table, and an
  // output written from it, are another table's.
  assert.notEqual(second.origin, read.origin);
  const staleEdit = { type: "editGrid", table: { headers: ["value"], rows: [["EDITED"]] }, origin: read.origin };
  assert.equal(next(second, staleEdit), second);
  assert.equal(offeredDownload(second, "excel", { table: read.table, format: "excel" }), null);
  // Choosing the sheet shown, a sheet the workbook hasn't, or a sheet on
  // another input format changes nothing.
  assert.equal(next(second, { type: "sheet", sheet: 1 }), second);
  assert.equal(next(second, { type: "sheet", sheet: 3 }), second);
  const asCsv = next(second, { type: "inputFormat", format: "csv" });
  assert.equal(next(asCsv, { type: "sheet", sheet: 0 }), asCsv);
  // ...whose text is still the workbook's, so it keeps it for when Excel is
  // picked again.
  assert.deepEqual([asCsv.inputText, asCsv.fileName, asCsv.workbook.sheet], ["csv:S2a|S2b", "book.xlsx", 1]);
  assert.equal(next(next(asCsv, { type: "inputFormat", format: "excel" }), { type: "sheet", sheet: 2 }).inputText, "excel:S3a|S3b");
});

test("a workbook stays with the input's text: edits keep it, text of the visitor's own, Clear or another file drop it", () => {
  const read = run(start("excel"), { type: "upload", name: "book.xlsx", ticket: 1 }, { type: "readWorkbook", ticket: 1, workbook: book("S") });
  const typed = next(read, { type: "type", text: "excel:S1a|S1b|TYPED" });
  assert.deepEqual([typed.fileName, typed.workbook?.sheet], ["book.xlsx", 0]);
  const edited = next(read, { type: "editGrid", table: { headers: ["value"], rows: [["G"]] }, origin: read.origin });
  assert.deepEqual([edited.inputText, edited.fileName, edited.workbook?.sheet], ["excel:G", "book.xlsx", 0]);
  // A typo keeps it too: the text is still the file's, and a sheet brings a table back.
  const typo = next(read, { type: "type", text: "excel:S1a BROKEN" });
  assert.deepEqual([typo.table, typo.fileName], [null, "book.xlsx"]);
  assert.deepEqual(cells(next(typo, { type: "sheet", sheet: 1 })), ["S2a", "S2b"]);
  // A file that can't be read leaves the input's text, so the workbook too.
  const unreadable = run(read, { type: "upload", name: "old.xls", ticket: 2 }, { type: "readFailed", ticket: 2, error: "old.xls couldn't be read" });
  assert.deepEqual([unreadable.table, unreadable.fileName, unreadable.workbook?.sheets.length], [null, "book.xlsx", 2]);
  for (const dropped of [
    next(read, { type: "type", text: "excel:PASTED", replacesInput: true }),
    next(read, { type: "clear" }),
    run(read, { type: "upload", name: "c.csv", ticket: 3 }, { type: "read", ticket: 3, text: "csv:C", format: "csv" }),
  ]) {
    assert.equal(dropped.workbook, null);
    assert.equal(next(dropped, { type: "sheet", sheet: 1 }), dropped);
  }
});

test("a sheet keeps its edits: typing or a grid edit, then another sheet and back, shows the edited text (#299 review)", () => {
  const read = run(start("excel"), { type: "upload", name: "book.xlsx", ticket: 1 }, { type: "readWorkbook", ticket: 1, workbook: book("S", 3) });
  const typed = next(read, { type: "type", text: "excel:S1a|S1b|TYPED" });
  const back = run(typed, { type: "sheet", sheet: 1 }, { type: "sheet", sheet: 0 });
  assert.deepEqual([back.inputText, cells(back), back.fileName], ["excel:S1a|S1b|TYPED", ["S1a", "S1b", "TYPED"], "book.xlsx"]);
  // A table afresh each time, so nothing written before the switch is offered.
  assert.notEqual(back.origin, typed.origin);
  assert.equal(offeredDownload(back, "excel", { table: typed.table, format: "excel" }), null);
  assert.equal(offeredDownload(back, "csv", { table: back.table, format: "csv" }).name, "book.csv");
  // A grid edit on the second sheet stays with it; the first keeps its own.
  const second = next(back, { type: "sheet", sheet: 1 });
  const edited = next(second, { type: "editGrid", table: { headers: ["value"], rows: [["G"]] }, origin: second.origin });
  assert.deepEqual(edited.workbook.sheets.map((sheet) => sheet.text), ["excel:S1a|S1b|TYPED", "excel:G", "excel:S3a|S3b"]);
  assert.equal(run(edited, { type: "sheet", sheet: 0 }, { type: "sheet", sheet: 1 }).inputText, "excel:G");
  // A typo is kept as typed too: it's what the input held.
  const typo = run(edited, { type: "type", text: "excel:G BROKEN" }, { type: "sheet", sheet: 2 }, { type: "sheet", sheet: 1 });
  assert.deepEqual([typo.inputText, typo.table], ["excel:G BROKEN", null]);
  // In another format the text isn't a sheet's: the sheet keeps the last
  // Excel text it had, and takes the table's again when Excel is picked.
  const asCsv = run(edited, { type: "inputFormat", format: "csv" }, { type: "type", text: "csv:G|CSV" });
  assert.equal(asCsv.workbook.sheets[1].text, "excel:G");
  const asExcel = next(asCsv, { type: "inputFormat", format: "excel" });
  assert.deepEqual([asExcel.inputText, asExcel.workbook.sheets[1].text], ["excel:G|CSV", "excel:G|CSV"]);
  assert.equal(run(asExcel, { type: "sheet", sheet: 0 }, { type: "sheet", sheet: 1 }).inputText, "excel:G|CSV");
});

test("choosing a sheet while another file is read wins over it, as typing does; a late workbook read is dropped", () => {
  const read = run(start("excel"), { type: "upload", name: "a.xlsx", ticket: 1 }, { type: "readWorkbook", ticket: 1, workbook: book("A") });
  const reading = next(read, { type: "upload", name: "b.xlsx", ticket: 2 });
  const chosen = next(reading, { type: "sheet", sheet: 1 });
  assert.deepEqual([chosen.upload, chosen.fileName, cells(chosen)], [null, "a.xlsx", ["A2a", "A2b"]]);
  assert.equal(next(chosen, { type: "readWorkbook", ticket: 2, workbook: book("B") }), chosen);
  // b.xlsx read in time replaces a.xlsx, its first sheet shown.
  const replaced = next(reading, { type: "readWorkbook", ticket: 2, workbook: book("B") });
  assert.deepEqual([replaced.fileName, cells(replaced), replaced.workbook.sheet], ["b.xlsx", ["B1a", "B1b"], 0]);
});

test("a workbook with no sheet to show fails as an unreadable file: no table, the input's text keeps its name", () => {
  const empty = run(afterA(), { type: "upload", name: "empty.xlsx", ticket: 2 }, { type: "readWorkbook", ticket: 2, workbook: book("E", 0) });
  assert.deepEqual([empty.table, empty.fileName, empty.inputText, empty.workbook, empty.upload], [null, "a.csv", "csv:AAA_FIRST", null, null]);
  assert.match(empty.error, /empty\.xlsx has no visible sheet/);
});

test("nothing is offered while a file is read, or while the input has an error", () => {
  const tableA = { headers: ["name"], rows: [["AAA_FIRST"]] };
  const written = { table: tableA, format: "excel" };
  const page = { upload: null, error: null, table: tableA, outputFormat: "excel" };
  assert.equal(canOfferOutput(page, written), true);
  assert.equal(canOfferOutput({ ...page, upload: { name: "b.csv", ticket: 2 } }, written), false);
  assert.equal(canOfferOutput({ ...page, error: "Unclosed quote." }, written), false);
  assert.equal(canOfferOutput({ ...page, table: null }, written), false);
  assert.equal(canOfferOutput(page, null), false);
});

test("an output written from the previous table or for another format isn't offered", () => {
  const tableA = { headers: ["name"], rows: [["AAA_FIRST"]] };
  const tableB = { headers: ["name"], rows: [["BBB_SECOND"]] };
  const page = { upload: null, error: null, table: tableB, outputFormat: "excel" };
  // The round-1 case: b.csv is parsed, a.csv's workbook is still the one written.
  assert.equal(canOfferOutput(page, { table: tableA, format: "excel" }), false);
  // A table with the same cells is still another table until it's written.
  assert.equal(canOfferOutput(page, { table: structuredClone(tableB), format: "excel" }), false);
  assert.equal(canOfferOutput(page, { table: tableB, format: "pdf" }), false);
  assert.equal(canOfferOutput(page, { table: tableB, format: "excel" }), true);
});

// Generated sequences. Each runs visitor actions and the page's asynchronous
// work in a random order: uploads that read, can't be read, don't parse or
// are in another format, finishing late and out of order; Excel workbooks
// (#266) of one to three sheets, that can't be read, are over the reader's
// limits, have no sheet to show or leave some sheets out; Excel files and
// files on the Excel input that are text (#299 review: an .xls of
// tab-separated cells or an HTML table, a tab-delimited .txt); choosing a
// sheet, while another file is read or not, and coming back to a sheet
// after editing it; typing (edits, typos and their fixes,
// pastes over all of the input, emptying it); grid edits from a grid that
// may still show an earlier table; input and output format switches; binary
// outputs that finish after the table changed; clears. A reference model,
// kept here from the rules alone, follows the same events: it holds its own
// input text and format, parses that text with the stand-in to know whether
// there's a table, and tracks the text's origin, the workbook it came from
// (each sheet's text as last edited) and the upload still being read. It
// never reads the page's state. After
// every step the test checks the page's input, table, error, name and
// workbook against it, and that Download offers exactly what it should,
// under that name.
const SEQUENCES = 12000;
const STEPS = 50;
const SEED = 281249;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACTIONS = [
  ["upload", 3], ["finish", 4], ["type", 4], ["editGrid", 4], ["syncGrid", 3],
  ["inputFormat", 2], ["outputFormat", 2], ["writeStart", 2], ["writeFinish", 2], ["clear", 1], ["sheet", 4], ["sheetBack", 5],
];
const INPUT_FORMATS = ["csv", "json", "excel"];
const OUTPUT_FORMATS = ["json", "csv", "excel", "pdf"];
const BINARY = new Set(["excel", "pdf"]);
const EXTENSIONS = { csv: "csv", json: "json", excel: "xlsx" };

// The model: what the rules say the page holds.
function newModel(format) {
  return {
    format,
    text: "",
    userInput: false,
    // The file the input's text came from, or null.
    name: null,
    // The ticket of the upload still being read.
    pending: null,
    // The workbook the text came from: its file, its sheets and the one
    // whose text went into the input; null for any other text.
    workbook: null,
    // The table the text parses into (the placeholder before any input),
    // or null; and whether the page shows an error.
    table: placeholder,
    error: false,
    // A new object whenever a table starts afresh (a file read, a failure, a
    // clear): the grid may edit only the table of the lineage it shows.
    lineage: {},
    // Counts every change to the table, so a written output is of the table
    // on screen only if nothing changed it since.
    version: 0,
  };
}

// The model's table, from its own text: the placeholder until the visitor
// gives any input, else the text parsed in its format.
function reparse(model, { afresh = false } = {}) {
  const had = model.table;
  if (!model.userInput && !model.text.trim()) {
    model.table = placeholder;
    model.error = false;
    model.name = null;
    model.workbook = null;
  } else {
    model.table = parse(model.format, model.text).table;
    model.error = !model.table;
  }
  model.version += 1;
  if (afresh || !had || !model.table) model.lineage = {};
}

function runSequence(rng, seen, log) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const weighted = () => {
    let roll = rng() * ACTIONS.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [name, weight] of ACTIONS) if ((roll -= weight) < 0) return name;
    return ACTIONS[0][0];
  };
  const firstFormat = pick(INPUT_FORMATS);
  let state = start(firstFormat);
  const model = newModel(firstFormat);
  let outputFormat = pick(OUTPUT_FORMATS);
  let tickets = 0;
  let cellCount = 0;
  const reads = []; // uploads still being read, in any order
  const writes = []; // binary outputs being written
  let written = null; // the last binary output written
  // What the grid holds: the table it last synced, with that table's origin
  // (which its edits report) and the model's lineage; null once it's removed
  // because there's no table.
  let grid = { table: state.table, origin: state.origin, lineage: model.lineage };

  for (let step = 0; step < STEPS; step += 1) {
    const action = weighted();
    let event = null;
    if (action === "upload") {
      const id = (tickets += 1);
      const detected = pick([...INPUT_FORMATS, "excel", null]);
      const xls = detected === "excel" && rng() < 0.4;
      const name = `f${id}.${xls ? "xls" : detected ? EXTENSIONS[detected] : "dat"}`;
      // As the page decides when the file is chosen: a workbook when its
      // first bytes are a ZIP's or an OLE file's and its name says Excel, or
      // nothing does and the input is Excel; an .xlsx whatever it holds.
      // Anything else is text.
      const workbookBytes = rng() < 0.6;
      const asWorkbook = detected === "excel" ? !xls || workbookBytes : detected === null && model.format === "excel" && workbookBytes;
      if (asWorkbook) {
        const outcome = pick(["ok", "ok", "ok", "partial", "brokenSheet", "unreadable", "tooLarge", "noSheets"]);
        const count = outcome === "noSheets" ? 0 : 1 + Math.floor(rng() * 3);
        const broken = outcome === "brokenSheet" ? Math.floor(rng() * count) : -1;
        const workbook = {
          sheets: Array.from({ length: count }, (_, index) => ({
            name: `S${index + 1}`,
            text: `excel:W${id}s${index + 1}a|W${id}s${index + 1}b${index === broken ? " BROKEN" : ""}`,
          })),
          hidden: Math.floor(rng() * 2),
          skipped: outcome === "partial" ? 1 : 0,
          ...(outcome === "partial" ? { stop: "size" } : {}),
          tooManyCells: outcome === "partial" ? ["Big"] : [],
        };
        reads.push({ name, ticket: id, workbook, outcome });
      } else {
        // An Excel file's text is cells as Excel copies them, or an HTML
        // table; a file with no format of its own is read in the input's.
        const format = detected === "excel" ? pick(["excel", "html"]) : detected;
        const textFormat = format ?? pick(INPUT_FORMATS);
        const outcome = pick(["ok", "ok", "unparseable", "unreadable", "empty"]);
        const text = outcome === "empty" ? "" : `${textFormat}:F${id}a|F${id}b${outcome === "unparseable" ? " BROKEN" : ""}`;
        const kind = detected === "excel" ? "excelText" : detected === null && model.format === "excel" ? "textOnExcel" : null;
        reads.push({ name, ticket: id, text, format, outcome, kind });
      }
      event = { type: "upload", name, ticket: id };
    } else if (action === "finish") {
      if (!reads.length) continue;
      // Any read may finish next: a slow earlier one can finish last.
      const read = reads.splice(Math.floor(rng() * reads.length), 1)[0];
      if (read.outcome === "unreadable" || read.outcome === "tooLarge") {
        event = { type: "readFailed", ticket: read.ticket, error: `${read.name} couldn't be read` };
      } else if (read.workbook) {
        event = { type: "readWorkbook", ticket: read.ticket, workbook: read.workbook };
      } else {
        event = { type: "read", ticket: read.ticket, text: read.text, format: read.format };
      }
      event.file = read;
    } else if (action === "type") {
      cellCount += 1;
      const other = pick(INPUT_FORMATS.filter((format) => format !== model.format));
      const kind = pick(["append", "typo", "fix", "fix", "fresh", "freshBroken", "other", "empty"]);
      const text = {
        append: `${model.text}|T${cellCount}`,
        typo: `${model.text} BROKEN`,
        fix: model.text.replaceAll(" BROKEN", ""),
        fresh: `${model.format}:T${cellCount}`,
        freshBroken: `${model.format}:T${cellCount} BROKEN`,
        other: `${other}:T${cellCount}`,
        empty: "",
      }[kind];
      // A change that leaves the text as it was fires no change event.
      if (text === model.text) continue;
      // Whether it replaced all of the text (a paste over a select-all).
      event = { type: "type", text, replacesInput: rng() < 0.35 };
    } else if (action === "editGrid") {
      if (!grid) continue;
      cellCount += 1;
      event = { type: "editGrid", table: { headers: grid.table.headers, rows: [...grid.table.rows, [`G${cellCount}`]] }, origin: grid.origin };
    } else if (action === "syncGrid") {
      // The editor's effect: the grid takes the table on screen, or goes.
      grid = state.table ? { table: state.table, origin: state.origin, lineage: model.lineage } : null;
      continue;
    } else if (action === "inputFormat") {
      event = { type: "inputFormat", format: pick(INPUT_FORMATS.filter((format) => format !== model.format)) };
    } else if (action === "outputFormat") {
      outputFormat = pick(OUTPUT_FORMATS);
      log.push(`output ${outputFormat}`);
    } else if (action === "writeStart") {
      // As the page's effect: a binary output of the table on screen.
      if (BINARY.has(outputFormat) && state.table && state.hasUserInput && !state.error) {
        writes.push({ table: state.table, format: outputFormat, version: model.version, name: model.name });
        log.push("write start");
      }
    } else if (action === "writeFinish") {
      // Finishes even if the table changed since; the page's gate, not the
      // write's cancellation, must keep it from being offered.
      if (!writes.length) continue;
      written = writes.splice(Math.floor(rng() * writes.length), 1)[0];
      log.push(`write finish (${written.name ?? "no file"})`);
    } else if (action === "clear") {
      event = { type: "clear" };
    } else if (action === "sheet") {
      // The picker's choice: any sheet, or the one shown; and, as a stale
      // or stray event would, one the workbook hasn't.
      event = { type: "sheet", sheet: Math.floor(rng() * ((model.workbook?.sheets.length ?? 1) + 1)) };
    } else if (action === "sheetBack") {
      // Back to the sheet shown before, as a visitor checks an edit.
      if (model.workbook?.previous === undefined) continue;
      event = { type: "sheet", sheet: model.workbook.previous };
    }

    if (event) {
      const { file, ...pageEvent } = event;
      const before = state;
      const had = { table: model.table, name: model.name, workbook: model.workbook, pending: model.pending };
      log.push(JSON.stringify(pageEvent));
      state = next(before, pageEvent);
      const unchanged = () => assert.equal(state, before, "the event changes nothing");

      switch (event.type) {
        case "upload":
          model.pending = event.ticket;
          break;
        case "read":
        case "readWorkbook":
        case "readFailed":
          if (model.pending !== event.ticket) {
            seen.droppedReads += 1;
            unchanged();
            break;
          }
          model.pending = null;
          if (event.type === "readFailed" || (event.type === "readWorkbook" && !file.workbook.sheets.length)) {
            // The input keeps its text and origin, and the workbook that
            // text came from; the table goes.
            seen.unreadable += 1;
            if (model.name) seen.unreadableKeepsName += 1;
            if (model.workbook) seen.unreadableKeepsWorkbook += 1;
            if (file.workbook) seen.workbookFailures += 1;
            model.table = null;
            model.error = true;
            model.version += 1;
            model.lineage = {};
            break;
          }
          if (event.type === "readWorkbook") {
            // The first sheet's text is in the input, as an Excel input's:
            // it's the file's, and so is the workbook.
            model.text = file.workbook.sheets[0].text;
            model.format = "excel";
            model.workbook = { file: file.name, read: file.workbook.sheets, sheets: file.workbook.sheets.map((sheet) => sheet.text), sheet: 0 };
            seen.workbookReads += 1;
          } else {
            // The file's text is in the input: it's the file's.
            model.text = event.text;
            model.format = event.format ?? model.format;
            if (model.workbook) seen.textDropsWorkbook += 1;
            model.workbook = null;
            if (file.kind) seen[file.kind] += 1;
          }
          model.userInput = true;
          model.name = file.name;
          reparse(model, { afresh: true });
          if (model.table) seen.readOk += 1;
          else seen.readUnparseable += 1;
          break;
        case "sheet": {
          // Only another sheet of the workbook the Excel input's text came
          // from replaces it.
          const { workbook } = model;
          if (!workbook || model.format !== "excel" || event.sheet >= workbook.sheets.length || event.sheet === workbook.sheet) {
            seen.ignoredSheets += 1;
            unchanged();
            break;
          }
          // Like typing, it wins over a file still being read. The sheet
          // comes back as it was last edited.
          if (model.pending !== null) seen.sheetWinsOverRead += 1;
          if (workbook.sheets[event.sheet] !== workbook.read[event.sheet].text) seen.sheetBackWithEdits += 1;
          seen.sheetSwitches += 1;
          model.pending = null;
          model.workbook = { ...workbook, sheet: event.sheet, previous: workbook.sheet };
          model.text = workbook.sheets[event.sheet];
          model.userInput = true;
          reparse(model, { afresh: true });
          break;
        }
        case "type":
          model.pending = null;
          // Text replacing all of the input, or typed into an empty one, is
          // the visitor's own; anything else edits the text that was there.
          if (event.replacesInput || !model.text.trim()) {
            if (model.workbook) seen.ownTextDropsWorkbook += 1;
            model.name = null;
            model.workbook = null;
          }
          model.text = event.text;
          model.userInput = true;
          reparse(model);
          if (had.name && event.replacesInput) seen.replacedNamed += 1;
          if (!had.table && model.table && model.name) seen.fixKeepsName += 1;
          if (had.table && !model.table && model.name) seen.typoKeepsName += 1;
          break;
        case "editGrid": {
          // An edit applies only to the table on screen: there is one, and
          // the grid shows its lineage.
          if (!model.table || grid.lineage !== model.lineage) {
            if (!model.table) seen.editsWithoutTable += 1;
            else seen.staleEdits += 1;
            unchanged();
            break;
          }
          seen.edits += 1;
          model.pending = null;
          model.userInput = true;
          const asInput = serialize(model.format, event.table);
          if (asInput.supported) {
            model.text = asInput.text;
            reparse(model);
          } else {
            // An input format the page can't write (Excel): the grid's table
            // stands, and the input keeps its text.
            model.table = event.table;
            model.error = false;
            model.version += 1;
          }
          break;
        }
        case "inputFormat": {
          // A table from the visitor's input is rewritten in the new format;
          // otherwise the same text is parsed in it. The text keeps its origin.
          const rewritten = model.table && model.userInput ? serialize(event.format, model.table) : null;
          if (rewritten?.supported) model.text = rewritten.text;
          model.format = event.format;
          reparse(model);
          if (!had.table && model.table && model.name) seen.formatTakesFileName += 1;
          break;
        }
        case "clear":
          model.pending = null;
          model.text = "";
          model.userInput = false;
          model.name = null;
          model.workbook = null;
          model.table = placeholder;
          model.error = false;
          model.version += 1;
          model.lineage = {};
          break;
      }
    }

    // While the input is Excel, the sheet shown holds its text, as typed,
    // edited or rewritten; in another format the sheet keeps what it had.
    if (model.workbook && model.format === "excel") {
      const sheets = model.workbook.sheets.slice();
      sheets[model.workbook.sheet] = model.text;
      model.workbook = { ...model.workbook, sheets };
    }

    // The page holds what the model says.
    assert.equal(state.inputText, model.text, "the input is the model's text");
    assert.equal(state.inputFormat, model.format, "the input format is the model's");
    assert.equal(state.hasUserInput, model.userInput);
    assert.equal(state.upload?.ticket ?? null, model.pending, "the upload being read is the model's");
    assert.equal(state.table === null, model.table === null, "a table is on screen exactly when the model's text parses");
    assert.deepEqual(state.table, model.table, "the table on screen is the model's text, parsed");
    if (model.table === placeholder) assert.equal(state.table, placeholder);
    assert.equal(Boolean(state.error), model.error, "an error exactly when there's no table");
    assert.equal(state.fileName, model.name, "the name is the origin of the model's text");
    assert.deepEqual(
      state.workbook?.sheets ?? null,
      model.workbook ? model.workbook.read.map((sheet, index) => ({ ...sheet, text: model.workbook.sheets[index] })) : null,
      "the workbook is the one the text came from, each sheet as last edited",
    );
    assert.equal(state.workbook?.sheet ?? null, model.workbook?.sheet ?? null, "the sheet is the one whose text went in last");
    if (model.workbook) assert.equal(state.fileName, model.workbook.file, "a workbook is there only under its own file's name");

    // Download: a text output is serialized from the table as the page
    // renders; a binary one is whatever write finished last. It's offered
    // exactly when it was written from the table on screen, for the output
    // format chosen, with no upload being read and no error.
    const textOutput = state.table ? { table: state.table, format: outputFormat, version: model.version, name: model.name } : null;
    const output = BINARY.has(outputFormat) ? written : textOutput;
    const offer = offeredDownload(state, outputFormat, output);
    const offerable = Boolean(model.table) && !model.error && model.pending === null;
    const current = Boolean(output) && output.version === model.version && output.format === outputFormat;
    assert.equal(Boolean(offer), offerable && current, "Download offers exactly the output of the table on screen");
    if (offer) {
      assert.equal(offer.output.table, state.table, "the offer is of the table on screen");
      assert.equal(offer.output.name, model.name, "its bytes were written while the input had the same origin");
      assert.equal(offer.name, outputFileName(model.name, outputFormat), "the offer takes that origin's name");
      if (model.name) seen.namedOffers += 1;
    }
  }
}

test(`the name and the offered download always describe the table on screen (${SEQUENCES} generated sequences of ${STEPS} steps)`, (t) => {
  const rng = mulberry32(SEED);
  const seen = {
    readOk: 0, readUnparseable: 0, unreadable: 0, unreadableKeepsName: 0, droppedReads: 0, edits: 0, staleEdits: 0,
    editsWithoutTable: 0, typoKeepsName: 0, fixKeepsName: 0, replacedNamed: 0, formatTakesFileName: 0, namedOffers: 0,
    workbookReads: 0, workbookFailures: 0, unreadableKeepsWorkbook: 0, sheetSwitches: 0, sheetWinsOverRead: 0,
    ignoredSheets: 0, ownTextDropsWorkbook: 0, sheetBackWithEdits: 0, excelText: 0, textOnExcel: 0, textDropsWorkbook: 0,
  };
  for (let sequence = 0; sequence < SEQUENCES; sequence += 1) {
    const log = [];
    try {
      runSequence(rng, seen, log);
    } catch (error) {
      error.message = `sequence ${sequence} (seed ${SEED}): ${error.message}\n  ${log.join("\n  ")}`;
      throw error;
    }
  }
  // The sequences reach every case the reviews found, many times over.
  t.diagnostic(`cases reached: ${JSON.stringify(seen)}`);
  for (const [name, count] of Object.entries(seen)) assert.ok(count >= 100, `${name} reached only ${count} times`);
});

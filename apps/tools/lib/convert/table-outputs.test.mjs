import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import avro from "avsc";
import protobuf from "protobufjs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { checkOutputFormat } from "./output-format.ts";
import {
  PDF_FONT_URL,
  avroSchema,
  excelNumber,
  fieldNames,
  isRightToLeft,
  needsUnicodeFont,
  pdfText,
  protoSchema,
  writeTableOutput,
} from "./table-outputs.ts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fontBytes = readFileSync(path.join(appRoot, "public", PDF_FONT_URL));
let fontLoads = 0;
const loadFont = async () => {
  fontLoads += 1;
  return fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength);
};

// Cells that break naive writers: quotes, commas, line breaks, empty cells,
// leading zeros, numbers that look like dates, and markup.
const TRICKY = {
  headers: ["name", "zip", "price", "when", "notes"],
  rows: [
    ["Alpha", "02134", "1.50", "2024-01-05", 'said "hi", then left'],
    ["Beta", "", "12", "1/2/2024", "line one\nline two"],
    ["<b>&amp;</b>", "-0", "1e5", "", "=SUM(A1:A2)"],
  ],
};

function bigTable(rows, columns = 10) {
  return {
    headers: Array.from({ length: columns }, (_, index) => `Column ${index + 1}`),
    rows: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) =>
        column === 0 ? `row ${row}, "quoted"` : column === 1 ? "" : column === 2 ? `a\nb ${row}` : String(row * column),
      ),
    ),
  };
}

async function pdfPages(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    const [, , width, height] = page.view;
    pages.push({ width, height, items: content.items.map((item) => item.str).filter((text) => text.trim()) });
  }
  return pages;
}

function sheetCells(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const shared = [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si><t[^>]*>([\s\S]*?)<\/t><\/si>/g)].map(
    (match) => match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
  );
  const cells = {};
  for (const match of strFromU8(files["xl/worksheets/sheet1.xml"]).matchAll(/<c r="([A-Z]+\d+)"([^>]*)><v>([^<]*)<\/v><\/c>/g)) {
    const [, ref, attributes, value] = match;
    const style = /s="(\d+)"/.exec(attributes)?.[1] ?? null;
    cells[ref] = / t="s"/.test(attributes) ? { text: shared[Number(value)], style } : { number: Number(value), style };
  }
  return { files: Object.keys(files), cells, styles: strFromU8(files["xl/styles.xml"]) };
}

async function avroRecords(buffer) {
  const decoder = new avro.streams.BlockDecoder();
  const records = [];
  let header;
  decoder.on("metadata", (type, codec) => {
    header = { type, codec };
  });
  decoder.on("data", (record) => records.push({ ...record }));
  const ended = new Promise((resolve, reject) => {
    decoder.on("end", resolve);
    decoder.on("error", reject);
  });
  decoder.end(Buffer.from(buffer));
  await ended;
  return { ...header, records };
}

test("a cell is an Excel number only when it's a plain number that keeps its value", () => {
  assert.deepEqual(excelNumber("12"), { value: 12 });
  assert.deepEqual(excelNumber("0"), { value: 0 });
  assert.deepEqual(excelNumber("-3.25"), { value: -3.25 });
  assert.deepEqual(excelNumber("0.5"), { value: 0.5 });
  assert.deepEqual(excelNumber("1.50"), { value: 1.5, format: "0.00" });
  assert.deepEqual(excelNumber("123456789012345"), { value: 123456789012345 });
  for (const text of ["007", "02134", "-0", "1e5", "+1", "1,000", "1.", ".5", "12%", "$5", "2024-01-05", "1/2/2024", "1234567890123456", " 12", ""]) {
    assert.equal(excelNumber(text), null, text);
  }
});

test("Excel: one sheet, a bold header, plain numbers as numbers and everything else as its text", async () => {
  const output = await writeTableOutput("excel", TRICKY);
  assert.deepEqual(checkOutputFormat(output.buffer, "excel"), { ok: true });
  assert.deepEqual(checkOutputFormat(output.buffer, "xlsx"), { ok: true });
  const { files, cells, styles } = sheetCells(output.buffer);
  assert.deepEqual(files.filter((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml")), ["xl/worksheets/sheet1.xml"]);
  assert.equal(cells.A1.text, "name");
  const bold = /<cellXfs[^>]*>((?:<xf[^>]*>[^<]*<\/xf>)*)/.exec(styles)[1].match(/<xf[^>]*>/g)[Number(cells.A1.style)];
  assert.match(bold, /fontId="1"/);
  assert.match(styles, /<font>(?:(?!<\/font>).)*<b\/>/);
  assert.deepEqual(cells.A2, { text: "Alpha", style: null });
  assert.equal(cells.B2.text, "02134");
  assert.equal(cells.C2.number, 1.5);
  assert.match(styles, /formatCode="0\.00"/);
  assert.equal(cells.D2.text, "2024-01-05");
  assert.equal(cells.E2.text, 'said "hi", then left');
  assert.equal(cells.B3, undefined, "an empty cell is left empty");
  assert.equal(cells.C3.number, 12);
  assert.equal(cells.D3.text, "1/2/2024");
  assert.equal(cells.E3.text, "line one\nline two");
  assert.equal(cells.A4.text, "<b>&amp;</b>");
  assert.equal(cells.B4.text, "-0");
  assert.equal(cells.C4.text, "1e5");
  assert.equal(cells.E4.text, "=SUM(A1:A2)", "a formula-looking cell stays text");
});

test("Excel refuses a cell longer than Excel holds, rather than writing a file Excel calls corrupt", async () => {
  const table = { headers: ["a", "b"], rows: [["ok", "x".repeat(32_768)]] };
  await assert.rejects(writeTableOutput("excel", table), /at most 32,767 characters; column 2 of row 1 has 32,768/);
});

test("Excel, Avro and Protobuf write 10,000 rows", async () => {
  const table = bigTable(10_000);
  const excel = sheetCells((await writeTableOutput("excel", table)).buffer);
  assert.equal(excel.cells.A10001.text, 'row 9999, "quoted"');
  assert.equal(excel.cells.D10001.number, 9999 * 3);
  const avroFile = await avroRecords((await writeTableOutput("avro", table)).buffer);
  assert.equal(avroFile.records.length, 10_000);
  assert.equal(avroFile.records[9999].Column_3, "a\nb 9999");
  const pb = await writeTableOutput("protobuf", table);
  const Table = protobuf.parse(pb.schema, { keepCase: true }).root.lookupType("Table");
  const decoded = Table.toObject(Table.decode(new Uint8Array(pb.buffer)), { defaults: true });
  assert.equal(decoded.rows.length, 10_000);
  assert.equal(decoded.rows[9999].Column_1, 'row 9999, "quoted"');
});

test("PDF: Latin text uses the built-in font, with the header on every page", async () => {
  fontLoads = 0;
  const output = await writeTableOutput("pdf", bigTable(200, 3), { loadFont });
  assert.equal(fontLoads, 0, "a Latin-1 table downloads no font");
  assert.deepEqual(checkOutputFormat(output.buffer, "pdf"), { ok: true });
  const pages = await pdfPages(output.buffer);
  assert.equal(pages.length, output.pages);
  assert.ok(pages.length > 1, "200 rows span pages");
  for (const page of pages) {
    assert.ok(page.height > page.width, "three columns fit a portrait page");
    assert.deepEqual(page.items.slice(0, 3), ["Column 1", "Column 2", "Column 3"]);
  }
  const text = pages.flatMap((page) => page.items).join("\n");
  assert.ok(text.includes('row 199, "quoted"'));
  assert.ok(text.includes("b 199"));
});

test("PDF: Windows-1252 punctuation stays in the built-in font and comes out as typed", async () => {
  fontLoads = 0;
  const cell = "café – “quoted” — €5 … ‚„ Œœ Šš Žž Ÿ ƒ † ‡ ‰ ‹› • ™ ˆ˜ ¡¿ ÆØÅ ß ÿ";
  const output = await writeTableOutput("pdf", { headers: ["text"], rows: [[cell]] }, { loadFont });
  assert.equal(fontLoads, 0);
  const text = (await pdfPages(output.buffer))[0].items.join(" ");
  assert.equal(text, `text ${cell}`);
});

test("PDF: a wide table is landscape, and columns that don't fit continue on the next pages", async () => {
  const output = await writeTableOutput("pdf", bigTable(5, 40));
  const pages = await pdfPages(output.buffer);
  assert.ok(pages.length > 1);
  for (const page of pages) assert.ok(page.width > page.height);
  const headers = pages.flatMap((page) => page.items.filter((item) => item.startsWith("Column ")));
  assert.deepEqual(new Set(headers), new Set(Array.from({ length: 40 }, (_, index) => `Column ${index + 1}`)));
});

test("PDF: Greek, Cyrillic, Polish, Hebrew and Arabic load the Unicode font, and Hebrew reads right to left", async () => {
  fontLoads = 0;
  const table = {
    headers: ["name", "עיר"],
    rows: [
      ["Łódź Ωmega Жук", "תל אביב"],
      ["مرحبا", "שלום עולם 123"],
    ],
  };
  const output = await writeTableOutput("pdf", table, { loadFont });
  assert.equal(fontLoads, 1);
  // The font is embedded once, as a subset (jsPDF keeps every glyph's
  // metrics and name, about 50 KB compressed), not as the 757 KB file.
  assert.equal(new TextDecoder("latin1").decode(output.buffer).match(/\/FontFile2/g).length, 1);
  assert.ok(output.buffer.byteLength < 80_000, `${output.buffer.byteLength} bytes`);
  const items = (await pdfPages(output.buffer))[0].items;
  // pdf.js puts right-to-left text it reads back into typed order: a line
  // drawn backwards would come out reversed.
  assert.ok(items.includes("Łódź Ωmega Жук"), items.join(" | "));
  assert.ok(items.includes("עיר"));
  assert.ok(items.includes("תל אביב"));
  assert.ok(items.includes("שלום עולם 123"), items.join(" | "));
  assert.ok(items.some((item) => item.normalize("NFKC") === "مرحبا"), items.join(" | "));
});

test("PDF: text the font can't show fails with a clear message instead of a garbled file", async () => {
  await assert.rejects(
    writeTableOutput("pdf", { headers: ["名前"], rows: [["東京"], ["😀"]] }, { loadFont }),
    /The PDF can't show “名”, “前”, “東”, “京”, “😀”: .* Save the table as PNG or Excel instead\./,
  );
  await assert.rejects(writeTableOutput("pdf", { headers: ["a"], rows: [["ภาษาไทย"]] }, { loadFont }), /can't show “ภ”/);
});

test("PDF text: control and invisible characters go, line breaks stay", () => {
  assert.equal(pdfText("a\r\nb\rc\td\u0000e​f‎g️h­i"), "a\nb\nc    defghi");
  assert.equal(needsUnicodeFont([["café €5 “x”"]]), false);
  assert.equal(needsUnicodeFont([["ok"], ["Łódź"]]), true);
  assert.equal(isRightToLeft("123 שלום"), true);
  assert.equal(isRightToLeft("abc שלום"), false);
  assert.equal(isRightToLeft("مرحبا"), true);
});

test("field names are valid Avro and Protobuf names, unique, and say where they came from", () => {
  assert.deepEqual(
    fieldNames(["First Name", "e-mail", "2024", "Café", "名前", "", " Total ($) ", "a b", "a_b", "AB", "__proto__", "_id"]),
    ["First_Name", "e_mail", "_2024", "Cafe", "column_5", "column_6", "Total", "a_b", "a_b_2", "AB_3", "__proto___", "_id"],
  );
});

test("Avro: an object container with a record of nullable strings, empty cells as null", async () => {
  const output = await writeTableOutput("avro", TRICKY);
  assert.deepEqual(checkOutputFormat(output.buffer, "avro"), { ok: true });
  const file = await avroRecords(output.buffer);
  assert.equal(file.codec, "null");
  assert.deepEqual(file.type.schema(), {
    name: "Row",
    type: "record",
    fields: TRICKY.headers.map((name) => ({ name, type: ["null", "string"] })),
  });
  assert.deepEqual(
    avroSchema({ headers: ["First Name"], rows: [] }).fields,
    [{ name: "First_Name", type: ["null", "string"], default: null, doc: "First Name" }],
  );
  assert.deepEqual(file.records[1], { name: "Beta", zip: null, price: "12", when: "1/2/2024", notes: "line one\nline two" });
  assert.deepEqual(file.records.map((record) => record.name), ["Alpha", "Beta", "<b>&amp;</b>"]);
});

test("Protobuf: the .pb decodes back to the rows with the .proto it was written with", async () => {
  const table = { headers: ["First Name", "count", "notes"], rows: [["Alpha", "1", 'a "b"\nc'], ["Beta", "", "שלום"]] };
  const output = await writeTableOutput("protobuf", table);
  assert.equal(
    output.schema,
    [
      "// The schema of the .pb file saved with it, a Table message. To read it,",
      "// for example: protoc --decode=Table table.proto < table.pb",
      'syntax = "proto3";',
      "",
      "// One row: each field is one column's text, empty when the cell was.",
      "message Row {",
      '  string First_Name = 1; // "First Name"',
      "  string count = 2;",
      "  string notes = 3;",
      "}",
      "",
      "message Table {",
      "  repeated Row rows = 1;",
      "}",
      "",
    ].join("\n"),
  );
  const Table = protobuf.parse(output.schema, { keepCase: true }).root.lookupType("Table");
  const decoded = Table.toObject(Table.decode(new Uint8Array(output.buffer)), { defaults: true });
  assert.deepEqual(decoded.rows, [
    { First_Name: "Alpha", count: "1", notes: 'a "b"\nc' },
    { First_Name: "Beta", count: "", notes: "שלום" },
  ]);
});

test("Protobuf: a header can't break out of its comment, and field numbers skip the reserved range", () => {
  const schema = protoSchema({ headers: ['x\nmessage Evil {}\n"'], rows: [] });
  assert.match(schema, /string x_message_Evil = 1; \/\/ "x\\nmessage Evil \{\}\\n\\""/);
  assert.equal(schema.split("\n").filter((line) => line.startsWith("message")).length, 2);
  const wide = protoSchema({ headers: Array.from({ length: 19_001 }, (_, index) => `c${index}`), rows: [] });
  assert.match(wide, /string c18998 = 18999;\n {2}string c18999 = 20000;\n {2}string c19000 = 20001;/);
});

test("a table with a header and no rows still makes a file that opens", async () => {
  const table = { headers: ["name", "count"], rows: [] };
  assert.equal(sheetCells((await writeTableOutput("excel", table)).buffer).cells.B1.text, "count");
  const pdf = await writeTableOutput("pdf", table);
  assert.deepEqual((await pdfPages(pdf.buffer)).map((page) => page.items), [["name", "count"]]);
  const avroFile = await avroRecords((await writeTableOutput("avro", table)).buffer);
  assert.deepEqual([avroFile.codec, avroFile.records], ["null", []]);
  const pb = await writeTableOutput("protobuf", table);
  assert.equal(pb.buffer.byteLength, 0, "an empty Table message is no bytes");
  const Table = protobuf.parse(pb.schema, { keepCase: true }).root.lookupType("Table");
  assert.deepEqual(Table.toObject(Table.decode(new Uint8Array(pb.buffer)), { defaults: true }), { rows: [] });
});

test("a table without columns is refused", async () => {
  await assert.rejects(writeTableOutput("excel", { headers: [], rows: [] }), /no columns/);
});

// Writes a table as a binary file (#249): Excel, PDF, PNG, JPEG, Avro and
// Protobuf, for the table converter pages and for CSV to JPG on the generic
// converter page. Each library is imported only when its output is written,
// so no page loads one before a visitor asks for that output.

import { checkOutputFormat } from "./output-format.ts";
import { fetchPdfFont, isBuiltInText, isRightToLeft, embedUnicodeFont, shapeArabic, withoutJoiners } from "./pdf-font.ts";
import type { TableData } from "./table-data.ts";
import { writeTableImage } from "./table-image.ts";

export { PDF_FONT_URL, isRightToLeft } from "./pdf-font.ts";

export type BinaryTableFormat = "excel" | "pdf" | "png" | "jpeg" | "avro" | "protobuf";

export type TableOutput = {
  buffer: ArrayBuffer;
  // What the visitor should know about the file, such as the rows an image
  // leaves out.
  notice?: string;
  // Protobuf: the .proto schema the .pb file was written with.
  schema?: string;
  // PDF: how many pages it has.
  pages?: number;
  // PNG and JPEG: the image's size in pixels.
  image?: { width: number; height: number };
};

export type TableOutputOptions = {
  // PDF: the Unicode font's bytes, for text the built-in font can't draw.
  loadFont?: () => Promise<ArrayBuffer>;
};

// Writes the file, then refuses bytes that aren't the promised format, as
// convertWithWorker does, so a page can't save the wrong bytes.
export async function writeTableOutput(
  format: BinaryTableFormat,
  table: TableData,
  options: TableOutputOptions = {},
): Promise<TableOutput> {
  if (!table.headers.length) throw new Error("The table has no columns.");
  let output: TableOutput;
  switch (format) {
    case "excel":
      output = await writeExcel(table);
      break;
    case "pdf":
      output = await writePdf(table, options.loadFont ?? fetchPdfFont);
      break;
    case "png":
    case "jpeg":
      output = await writeTableImage(table, format);
      break;
    case "avro":
      output = await writeAvro(table);
      break;
    case "protobuf":
      output = await writeProtobuf(table);
      break;
    default:
      throw new Error(`${String(format)} isn't a binary table output.`);
  }
  const check = checkOutputFormat(output.buffer, format);
  if (!check.ok) {
    throw new Error(
      `The converter produced ${check.detected.toUpperCase()} instead of ${check.expected.toUpperCase()}.`,
    );
  }
  return output;
}

// A CommonJS package's exports, whether the bundler or Node hands them over
// as the module or as its default export.
function commonJs<T extends object>(module: T): T {
  return "default" in module && module.default ? (module.default as T) : module;
}

// ---------------------------------------------------------------- Excel --

const EXCEL_MAX_ROWS = 1_048_576;
const EXCEL_MAX_COLUMNS = 16_384;
const EXCEL_MAX_CELL = 32_767;
// Excel keeps 15 significant digits; a longer number would change.
const EXCEL_MAX_DIGITS = 15;

// A cell that is a plain number (no leading zero, sign, exponent or
// separators) is written as one, so it sums; anything else, zip codes, IDs
// and dates included, stays the text it was. Trailing zeros after the point
// are kept as the number's display format.
export function excelNumber(value: string): { value: number; format?: string } | null {
  const match = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const digits = value.replace(/^-/, "").replace(".", "").replace(/^0+/, "");
  if (digits.length > EXCEL_MAX_DIGITS) return null;
  const number = Number(value);
  if (Object.is(number, -0)) return null;
  if (String(number) === value) return { value: number };
  return { value: number, format: `0.${"0".repeat(match[1]?.length ?? 0)}` };
}

type ExcelCell = {
  value: string | number;
  type: StringConstructor | NumberConstructor;
  format?: string;
  fontWeight?: "bold";
  wrap?: boolean;
} | null;

function excelCell(value: string, header = false): ExcelCell {
  if (!value) return null;
  if (header) return { value, type: String, fontWeight: "bold", wrap: value.includes("\n") || undefined };
  const number = excelNumber(value);
  if (number) return { ...number, type: Number };
  return { value, type: String, wrap: value.includes("\n") || undefined };
}

function excelLimits(table: TableData) {
  if (table.rows.length + 1 > EXCEL_MAX_ROWS) {
    throw new Error(
      `Excel holds at most ${EXCEL_MAX_ROWS.toLocaleString("en-US")} rows; this table has ${(table.rows.length + 1).toLocaleString("en-US")} with its header. Save it as CSV instead.`,
    );
  }
  if (table.headers.length > EXCEL_MAX_COLUMNS) {
    throw new Error(
      `Excel holds at most ${EXCEL_MAX_COLUMNS.toLocaleString("en-US")} columns; this table has ${table.headers.length.toLocaleString("en-US")}. Save it as CSV instead.`,
    );
  }
  [table.headers, ...table.rows].forEach((row, rowIndex) => {
    row.forEach((cell, column) => {
      if (cell.length > EXCEL_MAX_CELL) {
        const where = rowIndex === 0 ? "the header" : `row ${rowIndex}`;
        throw new Error(
          `An Excel cell holds at most ${EXCEL_MAX_CELL.toLocaleString("en-US")} characters; column ${column + 1} of ${where} has ${cell.length.toLocaleString("en-US")}. Save the table as CSV instead.`,
        );
      }
    });
  });
}

// One sheet, its header row bold and frozen, each column as wide as its
// longest line (8 to 60 characters).
async function writeExcel(table: TableData): Promise<TableOutput> {
  excelLimits(table);
  const columns = table.headers.map((header, column) => {
    let widest = 0;
    for (const row of [table.headers, ...table.rows]) {
      for (const line of (row[column] ?? "").split("\n")) widest = Math.max(widest, line.length);
    }
    return { width: Math.min(60, Math.max(8, widest + 2)) };
  });
  const data = [
    table.headers.map((header) => excelCell(header, true)),
    ...table.rows.map((row) => row.map((cell) => excelCell(cell))),
  ];
  const { default: writeXlsxFile } = await import("write-excel-file/universal");
  const blob = await writeXlsxFile(data, { sheet: "Sheet1", columns, stickyRowsCount: 1 }).toBlob();
  return { buffer: await blob.arrayBuffer() };
}

// ------------------------------------------------------------------ PDF --

const PDF_MARGIN = 36;
const PDF_FONT_SIZE = 9;
const PDF_PADDING = 4;
// A column never needs to be wider than this to read well; longer text wraps.
const PDF_MAX_COLUMN = 180;
// Nor narrower than its text, up to this, so short columns aren't squeezed
// to a letter a line by a long one.
const PDF_MIN_COLUMN = 90;
const A4 = { width: 595.28, height: 841.89 };

// What a PDF cell shows: line breaks as \n, tabs as spaces, and no control
// or invisible formatting characters, which no font draws, bar the zero-width
// non-joiner and joiner (pdf-font.ts's withoutJoiners).
export function pdfText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    // Control characters are what this removes.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]|[\ufe00-\ufe0f]|(?!\u200c|\u200d)\p{Cf}/gu, "");
}

export function needsUnicodeFont(cells: string[][]): boolean {
  return cells.some((row) => row.some((cell) => !isBuiltInText(withoutJoiners(cell))));
}

// A4 pages with the header row on each, landscape when the columns need it,
// and columns that don't fit across continued on the following pages.
async function writePdf(table: TableData, loadFont: () => Promise<ArrayBuffer>): Promise<TableOutput> {
  let head = table.headers.map(pdfText);
  let body = table.rows.map((row) => row.map(pdfText));
  let cells = [head, ...body];
  const unicode = needsUnicodeFont(cells);
  const [{ jsPDF }, { autoTable }, fontBytes] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    unicode ? loadFont() : null,
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  let font = "helvetica";
  if (fontBytes) {
    // One font file, embedded once: the header row is shaded, not bold.
    font = embedUnicodeFont(doc, fontBytes, cells.flat(), "Save the table as PNG or Excel instead.");
  }
  // Each cell as it is drawn: its Arabic letters in the forms their
  // neighbours call for in the Unicode font, without joiners in Helvetica.
  const drawn = (text: string) => (fontBytes ? shapeArabic(doc, text) : withoutJoiners(text));
  head = head.map(drawn);
  body = body.map((row) => row.map(drawn));
  cells = [head, ...body];

  const headerStyle = unicode ? "normal" : "bold";
  doc.setFontSize(PDF_FONT_SIZE);
  const natural = head.map((_, column) => {
    let widest = 0;
    cells.forEach((row, rowIndex) => {
      doc.setFont(font, rowIndex === 0 ? headerStyle : "normal");
      for (const line of (row[column] ?? "").split("\n")) {
        // Text past this length wraps anyway.
        widest = Math.max(widest, doc.getTextWidth(line.slice(0, 120)));
      }
    });
    return widest;
  });
  const wanted = natural.reduce((sum, width) => sum + Math.min(width, PDF_MAX_COLUMN) + 2 * PDF_PADDING, 0);
  if (wanted > A4.width - 2 * PDF_MARGIN) {
    doc.addPage("a4", "landscape");
    doc.deletePage(1);
  }

  autoTable(doc, {
    head: [head],
    body,
    theme: "grid",
    margin: PDF_MARGIN,
    horizontalPageBreak: true,
    styles: {
      font,
      fontSize: PDF_FONT_SIZE,
      cellPadding: PDF_PADDING,
      overflow: "linebreak",
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
    },
    headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: headerStyle },
    columnStyles: Object.fromEntries(
      natural.map((width, column) => [column, { minCellWidth: Math.min(width, PDF_MIN_COLUMN) + 2 * PDF_PADDING }]),
    ),
    didParseCell: unicode
      ? (data) => {
          if (isRightToLeft(String(data.cell.raw ?? ""))) data.cell.styles.halign = "right";
        }
      : undefined,
  });
  return { buffer: doc.output("arraybuffer"), pages: doc.getNumberOfPages() };
}

// ------------------------------------------------------ Avro, Protobuf --

// Field names for the headers, valid in Avro and Protobuf: letters, digits
// and underscores, not starting with a digit. They're unique even ignoring
// case and underscores, since Protobuf's JSON names drop the underscores, and
// never a property every JavaScript object has: protobufjs loses a field
// named __proto__. A header with no usable letters becomes column_<n>.
export function fieldNames(headers: string[]): string[] {
  const taken = new Set<string>();
  const key = (name: string) => name.replace(/_/g, "").toLowerCase();
  return headers.map((header, index) => {
    let base = header
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, "")
      .replace(/[^A-Za-z0-9_]+/g, "_");
    if (!base) base = `column_${index + 1}`;
    if (/^\d/.test(base)) base = `_${base}`;
    if (base in Object.prototype) base = `${base}_`;
    let name = base;
    for (let suffix = 2; taken.has(key(name)); suffix += 1) name = `${base}_${suffix}`;
    taken.add(key(name));
    return name;
  });
}

// A record of nullable strings, one per column; each field's doc is the
// header it came from. An empty cell is written as null.
export function avroSchema(table: TableData) {
  const names = fieldNames(table.headers);
  return {
    type: "record" as const,
    name: "Row",
    fields: names.map((name, index) => ({
      name,
      type: ["null", "string"],
      default: null,
      doc: table.headers[index] ?? "",
    })),
  };
}

// An Avro object container file, uncompressed (the null codec).
async function writeAvro(table: TableData): Promise<TableOutput> {
  const avro = commonJs(await import("avsc"));
  const schema = avroSchema(table);
  const names = schema.fields.map((field) => field.name);
  // The header is written even for a table with no rows.
  const encoder = new avro.streams.BlockEncoder(schema, { codec: "null", writeHeader: "always" });
  const chunks: Uint8Array[] = [];
  const done = new Promise<void>((resolve, reject) => {
    encoder.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    encoder.on("end", () => resolve());
    encoder.on("error", reject);
  });
  for (const row of table.rows) {
    encoder.write(Object.fromEntries(names.map((name, index) => [name, row[index] || null])));
  }
  encoder.end();
  await done;
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { buffer: bytes.buffer };
}

// Protobuf reserves field numbers 19000 to 19999.
function protoFieldNumber(index: number): number {
  const number = index + 1;
  return number >= 19_000 ? number + 1_000 : number;
}

// The .proto schema: a Row message with one string field per column, and a
// Table message holding the rows. A header that isn't its field's name is
// kept in a comment beside it.
export function protoSchema(table: TableData): string {
  const names = fieldNames(table.headers);
  const fields = names.map((name, index) => {
    const header = table.headers[index] ?? "";
    const note = header === name ? "" : ` // ${JSON.stringify(header)}`;
    return `  string ${name} = ${protoFieldNumber(index)};${note}`;
  });
  return [
    "// The schema of the .pb file saved with it, a Table message. To read it,",
    "// for example: protoc --decode=Table table.proto < table.pb",
    'syntax = "proto3";',
    "",
    "// One row: each field is one column's text, empty when the cell was.",
    "message Row {",
    ...fields,
    "}",
    "",
    "message Table {",
    "  repeated Row rows = 1;",
    "}",
    "",
  ].join("\n");
}

// The encoded Table, written with the schema above as protobufjs parses it.
async function writeProtobuf(table: TableData): Promise<TableOutput> {
  const protobuf = commonJs(await import("protobufjs"));
  const schema = protoSchema(table);
  const names = fieldNames(table.headers);
  const Table = protobuf.parse(schema, { keepCase: true }).root.lookupType("Table");
  const message = Table.fromObject({
    rows: table.rows.map((row) => Object.fromEntries(names.map((name, index) => [name, row[index] ?? ""]))),
  });
  const bytes = Table.encode(message).finish();
  // In Node the bytes are a view on a shared buffer; copy out just them.
  return { buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, schema };
}

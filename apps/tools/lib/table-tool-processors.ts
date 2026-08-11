import { toolCatalog } from "@serp-tools/app-core/lib/tool-catalog";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { markdownTable } from "markdown-table";
import Papa from "papaparse";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
import { readSheet } from "read-excel-file/universal";
import writeXlsxFile from "write-excel-file/universal";
import YAML from "yaml";

import { executionProvenance } from "./tool-execution-provenance.ts";
import {
  getTableOperationPolicy,
  tableInputContracts,
  tableOutputContracts,
  type TableInputFormat,
  type TableOutputFormat,
} from "./table-operation-policy.ts";
import {
  createToolWorkflow,
  defineToolExecutionIntent,
  defineToolSupport,
  type ToolProcessor,
  type ToolWorkflow,
  type WorkflowMedia,
  type WorkflowOutcome,
  type WorkflowRequest,
} from "./tool-workflow/index.ts";

export type TableData = Readonly<{
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}>;

export type TableWorkflowDeliveryPort = (
  media: WorkflowMedia,
) => Promise<string>;

type TableWorkflowTelemetryPort = Readonly<{
  start(runId: string, request: WorkflowRequest, at: number): Promise<void>;
  terminal(
    runId: string,
    status: WorkflowOutcome["status"] | "cancelled",
    at: number,
  ): Promise<void>;
}>;

export type TableWorkflowPorts = Readonly<{
  deliver: TableWorkflowDeliveryPort;
  telemetry: TableWorkflowTelemetryPort;
  nextId(kind: "run" | "delivery"): string;
  clock?: Readonly<{ now(): number }>;
}>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const PDF_PAGE_WIDTH = 612;
const PDF_MARGIN = 36;
const PDF_FONT_SIZE = 9;
const PDF_CELL_PADDING = 6;
const PDFJS_WORKER_URL = "/vendor/pdfjs/pdf.worker.min.js";

type PdfTextItem = Readonly<{
  str: string;
  height: number;
  width: number;
  transform: readonly number[];
}>;

type PdfTextPage = Readonly<{
  view: readonly number[];
  getTextContent(options: {
    disableNormalization: boolean;
  }): Promise<Readonly<{ items: readonly (PdfTextItem | object)[] }>>;
}>;

type PdfTextModule = Readonly<{
  GlobalWorkerOptions?: { workerSrc: string };
  getDocument(options: {
    data: Uint8Array;
    isEvalSupported: boolean;
    useSystemFonts: boolean;
    useWorkerFetch: boolean;
  }): Readonly<{
    promise: Promise<
      Readonly<{
        numPages: number;
        getPage(pageNumber: number): Promise<PdfTextPage>;
      }>
    >;
    destroy(): Promise<void>;
  }>;
}>;

async function loadPdfTextModule(): Promise<PdfTextModule> {
  if (typeof window !== "undefined") {
    const pdfjs = (await import(
      /* webpackIgnore: true */ "/vendor/pdfjs/pdf.min.mjs"
    )) as unknown as PdfTextModule;
    if (pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    }
    return pdfjs;
  }
  return (await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  )) as unknown as PdfTextModule;
}

const tableEngine = executionProvenance.getEngine("browser-table-converter");
if (!tableEngine) {
  throw new TypeError("Missing browser table execution engine");
}
const verifiedTableEngine = tableEngine;

function parseCsv(bytes: Uint8Array): TableData {
  const text = decoder.decode(bytes);
  const data: string[][] = [];
  const errors: Array<{ code: string; message: string }> = [];
  let recordStart = 0;
  Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    step(result) {
      const rawRecord = text.slice(recordStart, result.meta.cursor);
      recordStart = result.meta.cursor;
      errors.push(...result.errors);
      if (rawRecord.replace(/(?:\r\n|\r|\n)$/, "").trim()) {
        data.push(result.data);
      }
    },
  });
  const fatalErrors = errors.filter(
    (error) => error.code !== "UndetectableDelimiter",
  );
  if (fatalErrors.length > 0) {
    throw new TypeError(fatalErrors[0]?.message ?? "CSV parse failed");
  }
  const [rawHeaders, ...rawRows] = data;
  if (!rawHeaders || rawHeaders.length === 0) {
    throw new TypeError("CSV requires a header row");
  }
  const headers = rawHeaders.map((header) => header.trim());
  if (headers.some((header) => !header)) {
    throw new TypeError("CSV headers must be non-empty");
  }
  if (new Set(headers).size !== headers.length) {
    throw new TypeError("CSV headers must be unique");
  }
  const rows = rawRows.map((row, index) => {
    if (row.length !== headers.length) {
      throw new TypeError(
        `CSV row ${index + 2} has ${row.length} cells; expected ${headers.length}`,
      );
    }
    return row.map(String);
  });
  return assertTable(headers, rows, "CSV");
}

function tableToObjects(
  table: TableData,
): ReadonlyArray<Record<string, string>> {
  return table.rows.map((row) =>
    Object.fromEntries(
      table.headers.map((header, index) => [header, row[index] ?? ""]),
    ),
  );
}

function recordsToTable(value: unknown, format: string): TableData {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (row) => row !== null && typeof row === "object" && !Array.isArray(row),
    )
  ) {
    throw new TypeError(
      `${format} table input must be a non-empty array of objects`,
    );
  }
  const records = value as Record<string, unknown>[];
  const headers = Object.keys(records[0] ?? {});
  if (
    headers.length === 0 ||
    records.some((row) => {
      const keys = Object.keys(row);
      return (
        keys.length !== headers.length ||
        keys.some((key) => !headers.includes(key))
      );
    })
  ) {
    throw new TypeError(`${format} rows must share one non-empty schema`);
  }
  const rows = records.map((record) =>
    headers.map((header) => {
      const cell = record[header];
      if (cell === null || cell === undefined) return "";
      return typeof cell === "object" ? JSON.stringify(cell) : String(cell);
    }),
  );
  return Object.freeze({
    headers: Object.freeze(headers),
    rows: Object.freeze(rows),
  });
}

function parseJson(bytes: Uint8Array): TableData {
  return recordsToTable(JSON.parse(decoder.decode(bytes)) as unknown, "JSON");
}

function parseYaml(bytes: Uint8Array): TableData {
  return recordsToTable(YAML.parse(decoder.decode(bytes)) as unknown, "YAML");
}

type HtmlNode = DefaultTreeAdapterMap["node"];

function htmlChildren(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? [...node.childNodes] : [];
}

function htmlElements(node: HtmlNode, tagName: string): HtmlNode[] {
  const matches = "tagName" in node && node.tagName === tagName ? [node] : [];
  return [
    ...matches,
    ...htmlChildren(node).flatMap((child) => htmlElements(child, tagName)),
  ];
}

function htmlText(node: HtmlNode): string {
  if ("nodeName" in node && node.nodeName === "#text" && "value" in node) {
    return node.value;
  }
  return htmlChildren(node).map(htmlText).join("");
}

function parseHtml(bytes: Uint8Array): TableData {
  const document = parseFragment(decoder.decode(bytes));
  const table = htmlElements(document, "table")[0];
  if (!table) throw new TypeError("HTML input requires a table element");
  const rows = htmlElements(table, "tr").map((row) =>
    htmlChildren(row)
      .filter(
        (cell) =>
          "tagName" in cell && (cell.tagName === "th" || cell.tagName === "td"),
      )
      .map((cell) => htmlText(cell).trim()),
  );
  const [headers, ...body] = rows;
  if (!headers) throw new TypeError("HTML table requires a header row");
  return assertTable(headers, body, "HTML");
}

function assertTable(
  rawHeaders: readonly string[],
  rawRows: readonly (readonly string[])[],
  format: string,
): TableData {
  const headers = rawHeaders.map((header) => header.trim());
  if (headers.length === 0 || headers.some((header) => !header)) {
    throw new TypeError(`${format} headers must be non-empty`);
  }
  if (new Set(headers).size !== headers.length) {
    throw new TypeError(`${format} headers must be unique`);
  }
  if (rawRows.length === 0) {
    throw new TypeError(`${format} table requires at least one data row`);
  }
  const rows = rawRows.map((row, index) => {
    if (row.length !== headers.length) {
      throw new TypeError(
        `${format} row ${index + 2} has ${row.length} cells; expected ${headers.length}`,
      );
    }
    return Object.freeze(row.map(String));
  });
  return Object.freeze({
    headers: Object.freeze(headers),
    rows: Object.freeze(rows),
  });
}

function parseSql(bytes: Uint8Array): TableData {
  const match = decoder
    .decode(bytes)
    .match(
      /^\s*insert\s+into\s+[`"\w.-]+\s*\(([^)]+)\)\s*values\s*([\s\S]+?)\s*;?\s*$/i,
    );
  if (!match?.[1] || !match[2]) {
    throw new TypeError("SQL input requires one INSERT with a column list");
  }
  const headers = match[1]
    .split(",")
    .map((header) => header.trim().replace(/^[`"]|[`"]$/g, ""));
  const rows: string[][] = [];
  const values = match[2];
  let tuple: string[] | undefined;
  let cell = "";
  let quoted = false;
  let quotedCell = false;
  let quoteClosed = false;
  let expectsTuple = true;
  const finishCell = () => {
    if (!tuple) throw new TypeError("SQL VALUES cell is outside a tuple");
    if (quotedCell) {
      if (!quoteClosed) {
        throw new TypeError("SQL quoted literal has invalid trailing tokens");
      }
      tuple.push(cell);
    } else {
      const literal = cell.trim();
      if (/^null$/i.test(literal)) {
        tuple.push("");
      } else if (/^(?:true|false)$/i.test(literal)) {
        tuple.push(literal.toLowerCase());
      } else if (
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(literal)
      ) {
        tuple.push(literal);
      } else {
        throw new TypeError(
          "SQL VALUES cells must be quoted strings, NULL, booleans, or decimal numbers",
        );
      }
    }
    cell = "";
    quotedCell = false;
    quoteClosed = false;
  };
  for (let index = 0; index < values.length; index += 1) {
    const character = values[index];
    if (quoted) {
      if (character === "'" && values[index + 1] === "'") {
        cell += "'";
        index += 1;
      } else if (character === "'") {
        quoted = false;
        quoteClosed = true;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === "'" && tuple) {
      if (cell.trim() || quotedCell || quoteClosed) {
        throw new TypeError(
          "SQL quoted literal must start at the cell boundary",
        );
      }
      cell = "";
      quotedCell = true;
      quoted = true;
    } else if (character === "(" && expectsTuple) {
      tuple = [];
      cell = "";
      expectsTuple = false;
    } else if (character === "," && tuple) {
      finishCell();
    } else if (character === ")" && tuple) {
      finishCell();
      rows.push(tuple);
      tuple = undefined;
      cell = "";
    } else if (!tuple && character === "," && !expectsTuple) {
      expectsTuple = true;
    } else if (!tuple && character === ";" && !expectsTuple) {
      if (values.slice(index + 1).trim()) {
        throw new TypeError("SQL input contains tokens after the INSERT");
      }
      break;
    } else if (!tuple && /^\s$/.test(character ?? "")) {
      continue;
    } else if (tuple) {
      if (quoteClosed && !/^\s$/.test(character ?? "")) {
        throw new TypeError("SQL quoted literal has invalid trailing tokens");
      }
      if (!quoteClosed) cell += character;
    } else {
      throw new TypeError("SQL input requires exactly one INSERT statement");
    }
  }
  if (quoted || tuple || expectsTuple) {
    throw new TypeError("SQL VALUES tuple is unterminated");
  }
  return assertTable(headers, rows, "SQL");
}

async function parseExcel(bytes: Uint8Array): Promise<TableData> {
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const sheet = await readSheet(arrayBuffer);
  if (sheet.length < 2 || (sheet[0]?.length ?? 0) < 1) {
    throw new TypeError("XLSX worksheet requires headers and at least one row");
  }
  const values = sheet.map((row) =>
    row.map((cell) => (cell === null ? "" : String(cell))),
  );
  const [headers, ...rows] = values;
  if (!headers) throw new TypeError("XLSX worksheet requires headers");
  return assertTable(headers, rows, "XLSX");
}

function splitDelimitedRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === "\\" && (next === delimiter || next === "\\")) {
      cell += next;
      index += 1;
    } else if (character === delimiter) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseMarkdown(bytes: Uint8Array): TableData {
  const lines = decoder
    .decode(bytes)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) {
    throw new TypeError("Markdown table requires a header, divider, and row");
  }
  const parseRow = (line: string) => {
    let row = line.startsWith("|") ? line.slice(1) : line;
    if (row.endsWith("|")) {
      let backslashes = 0;
      for (let index = row.length - 2; row[index] === "\\"; index -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) row = row.slice(0, -1);
    }
    return splitDelimitedRow(row, "|");
  };
  const [headerLine, dividerLine, ...rowLines] = lines;
  if (!headerLine || !dividerLine)
    throw new TypeError("Markdown table is incomplete");
  const divider = parseRow(dividerLine);
  if (!divider.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw new TypeError("Markdown table divider is invalid");
  }
  return assertTable(parseRow(headerLine), rowLines.map(parseRow), "Markdown");
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  trimValues: false,
});

function parseXml(bytes: Uint8Array): TableData {
  const text = decoder.decode(bytes);
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new TypeError(`XML parse failed: ${valid.err.msg}`);
  const parsed = xmlParser.parse(text) as Record<string, unknown>;
  const root = (parsed.rows ?? parsed) as Record<string, unknown>;
  const rawRows = Array.isArray(root.row)
    ? root.row
    : root.row
      ? [root.row]
      : [];
  if (rawRows.length === 0)
    throw new TypeError("XML input requires row elements");
  const first = rawRows[0] as Record<string, unknown>;
  const cellsForRow = (row: Record<string, unknown>) =>
    Array.isArray(row.cell)
      ? (row.cell as Record<string, unknown>[])
      : row.cell !== null && typeof row.cell === "object"
        ? [row.cell as Record<string, unknown>]
        : undefined;
  const firstCells = cellsForRow(first);
  if (firstCells) {
    const headers = firstCells.map((cell) => String(cell["@column"] ?? ""));
    const rows = rawRows.map((rawRow, rowIndex) => {
      const cells = cellsForRow(rawRow as Record<string, unknown>);
      if (!cells) return [];
      const entries = cells.map(
        (cell) =>
          [String(cell["@column"] ?? ""), String(cell["#text"] ?? "")] as const,
      );
      const byHeader = new Map(entries);
      if (
        entries.length !== headers.length ||
        byHeader.size !== headers.length ||
        headers.some((header) => !byHeader.has(header))
      ) {
        throw new TypeError(
          `XML row ${rowIndex + 2} does not match the header schema`,
        );
      }
      return headers.map((header) => byHeader.get(header) ?? "");
    });
    return assertTable(headers, rows, "XML");
  }
  const headers = Object.keys(first).filter((key) => !key.startsWith("@"));
  const rows = rawRows.map((row, rowIndex) => {
    const record = row as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => !key.startsWith("@"));
    if (
      keys.length !== headers.length ||
      keys.some((key) => !headers.includes(key))
    ) {
      throw new TypeError(
        `XML row ${rowIndex + 2} does not match the header schema`,
      );
    }
    return headers.map((header) => {
      const cell = record[header];
      if (cell !== null && typeof cell === "object") {
        throw new TypeError(
          `XML row ${rowIndex + 2} contains a non-scalar cell`,
        );
      }
      return String(cell ?? "");
    });
  });
  return assertTable(headers, rows, "XML");
}

function parseLatex(bytes: Uint8Array): TableData {
  const text = decoder.decode(bytes);
  const match = text.match(
    /\\begin\{tabular\}\{[^}]+\}([\s\S]*?)\\end\{tabular\}/,
  );
  if (!match?.[1])
    throw new TypeError("LaTeX input requires a tabular environment");
  const rows = match[1]
    .replace(/\\hline/g, "")
    .split(/\\\\/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => splitDelimitedRow(row, "&").map(unescapeLatex));
  const [headers, ...body] = rows;
  if (!headers) throw new TypeError("LaTeX table requires headers");
  return assertTable(headers, body, "LaTeX");
}

function unescapeLatex(value: string): string {
  return value
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\textbackslash\{\}/g, "\\");
}

function parseMediaWiki(bytes: Uint8Array): TableData {
  const lines = decoder
    .decode(bytes)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines[0]?.startsWith("{|") || lines.at(-1) !== "|}") {
    throw new TypeError("MediaWiki input requires a complete table document");
  }
  const headerLine = lines.find((line) => line.startsWith("!"));
  if (!headerLine) throw new TypeError("MediaWiki table requires a header row");
  const decodeCell = (cell: string) =>
    cell
      .trim()
      .replace(/&#124;/g, "|")
      .replace(/<br\s*\/>/gi, "\n");
  const headers = headerLine.slice(1).split("!!").map(decodeCell);
  const rows = lines
    .filter(
      (line) => line.startsWith("|") && !line.startsWith("|-") && line !== "|}",
    )
    .map((line) => line.slice(1).split("||").map(decodeCell));
  return assertTable(headers, rows, "MediaWiki");
}

export async function parseTableInput(
  format: TableInputFormat,
  bytes: Uint8Array,
): Promise<TableData> {
  switch (format) {
    case "csv":
      return parseCsv(bytes);
    case "excel":
      return parseExcel(bytes);
    case "html":
      return parseHtml(bytes);
    case "json":
      return parseJson(bytes);
    case "latex":
      return parseLatex(bytes);
    case "markdown":
      return parseMarkdown(bytes);
    case "mediawiki":
      return parseMediaWiki(bytes);
    case "mysql":
    case "sql":
      return parseSql(bytes);
    case "xml":
      return parseXml(bytes);
    case "yaml":
      return parseYaml(bytes);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1");
}

function escapeMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function escapeSql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function escapeMediaWiki(value: string): string {
  return value.replace(/\|/g, "&#124;").replace(/\r?\n/g, "<br />");
}

function sqlIdentifier(value: string, dialect: "mysql" | "sql"): string {
  return dialect === "mysql"
    ? `\`${value.replace(/`/g, "``")}\``
    : `"${value.replace(/"/g, '""')}"`;
}

async function serializeExcel(table: TableData): Promise<Uint8Array> {
  const blob = await writeXlsxFile(
    [table.headers, ...table.rows].map((row) => [...row]),
    { sheet: "Table" },
  ).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

async function serializePdf(table: TableData): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fontSize = PDF_FONT_SIZE;
  const lineHeight = 16;
  const margin = PDF_MARGIN;
  let page = document.addPage([PDF_PAGE_WIDTH, 792]);
  let y = page.getHeight() - margin;
  const drawRow = (row: readonly string[], header = false) => {
    const available = page.getWidth() - margin * 2;
    const width = available / table.headers.length;
    row.forEach((cell, index) => {
      page.drawRectangle({
        x: margin + index * width,
        y: y - lineHeight + 3,
        width,
        height: lineHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.6, 0.6, 0.6),
        color: header ? rgb(0.93, 0.95, 0.98) : undefined,
      });
      page.drawText(cell, {
        x: margin + index * width + 3,
        y: y - fontSize,
        size: fontSize,
        font,
        maxWidth: width - 6,
      });
    });
    y -= lineHeight;
  };
  drawRow(table.headers, true);
  for (const row of table.rows) {
    if (y < margin + lineHeight) {
      page = document.addPage([PDF_PAGE_WIDTH, 792]);
      y = page.getHeight() - margin;
      drawRow(table.headers, true);
    }
    drawRow(row);
  }
  return document.save();
}

async function serializeTable(
  format: TableOutputFormat,
  table: TableData,
): Promise<Uint8Array> {
  switch (format) {
    case "csv":
      return encoder.encode(
        Papa.unparse(
          {
            fields: [...table.headers],
            data: table.rows.map((row) => [...row]),
          },
          {
            quotes: (value) => table.headers.length === 1 && value === "",
          },
        ),
      );
    case "excel":
      return serializeExcel(table);
    case "html": {
      const fragment = parseFragment(
        `<table><thead><tr>${table.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      return encoder.encode(serialize(fragment));
    }
    case "json":
      return encoder.encode(JSON.stringify(tableToObjects(table), null, 2));
    case "jsonlines":
      return encoder.encode(
        tableToObjects(table)
          .map((row) => JSON.stringify(row))
          .join("\n"),
      );
    case "latex":
      return encoder.encode(
        [
          `\\begin{tabular}{${"l".repeat(table.headers.length)}}`,
          `${table.headers.map(escapeLatex).join(" & ")} \\\\`,
          "\\hline",
          ...table.rows.map(
            (row) => `${row.map(escapeLatex).join(" & ")} \\\\`,
          ),
          "\\end{tabular}",
        ].join("\n"),
      );
    case "markdown":
      return encoder.encode(
        markdownTable([
          table.headers.map(escapeMarkdown),
          ...table.rows.map((row) => row.map(escapeMarkdown)),
        ]),
      );
    case "mediawiki":
      return encoder.encode(
        [
          '{| class="wikitable"',
          `! ${table.headers.map(escapeMediaWiki).join(" !! ")}`,
          ...table.rows.flatMap((row) => [
            "|-",
            `| ${row.map(escapeMediaWiki).join(" || ")}`,
          ]),
          "|}",
        ].join("\n"),
      );
    case "mysql":
    case "sql":
      return encoder.encode(
        [
          `INSERT INTO ${format === "mysql" ? sqlIdentifier("table_name", format) : "table_name"} (${table.headers.map((header) => sqlIdentifier(header, format)).join(", ")}) VALUES`,
          ...table.rows.map(
            (row, index) =>
              `  (${row.map(escapeSql).join(", ")})${index === table.rows.length - 1 ? ";" : ","}`,
          ),
        ].join("\n"),
      );
    case "pdf":
      return serializePdf(table);
    case "xml": {
      const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: "@",
        format: true,
      });
      return encoder.encode(
        builder.build({
          rows: {
            row: table.rows.map((row) => ({
              cell: row.map((cell, index) => ({
                "@column": table.headers[index],
                "#text": cell,
              })),
            })),
          },
        }),
      );
    }
    case "yaml":
      return encoder.encode(YAML.stringify(tableToObjects(table)));
  }
}

export async function serializeTableInputText(
  format: TableInputFormat,
  table: TableData,
): Promise<string> {
  if (format === "excel") {
    throw new TypeError("XLSX input requires a binary workbook upload");
  }
  return decoder.decode(await serializeTable(format, table));
}

function tableEquals(left: TableData, right: TableData): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isWinAnsiText(value: string): boolean {
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code === 9 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255)
    );
  });
}

async function assertLosslessPdfLayout(table: TableData): Promise<void> {
  if (
    [...table.headers, ...table.rows.flat()].some((cell) => cell.trim() === "")
  ) {
    throw new TypeError(
      "PDF lossless layout cannot independently preserve empty cells",
    );
  }
  const availableWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  const cellWidth = availableWidth / table.headers.length;
  const textWidth = cellWidth - PDF_CELL_PADDING;
  if (textWidth <= 0) {
    throw new TypeError("PDF lossless layout has no drawable column width");
  }
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const overflowingCell = [...table.headers, ...table.rows.flat()].find(
    (cell) => font.widthOfTextAtSize(cell, PDF_FONT_SIZE) > textWidth,
  );
  if (overflowingCell !== undefined) {
    throw new TypeError(
      "PDF lossless layout cannot fit every cell within the page bounds",
    );
  }
}

export async function verifyTablePdfOutput(
  bytes: Uint8Array,
  expected: TableData,
): Promise<void> {
  const { getDocument } = await loadPdfTextModule();
  const loadingTask = getDocument({
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  const document = await loadingTask.promise;
  const observedRows: string[][] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const pageLeft = page.view[0];
      const pageRight = page.view[2];
      if (pageLeft === undefined || pageRight === undefined) {
        throw new TypeError("PDF page bounds are unavailable");
      }
      const text = await page.getTextContent({ disableNormalization: true });
      const items = text.items.filter(
        (item): item is PdfTextItem => "str" in item && item.height > 0,
      );
      if (
        items.some((item) => {
          const x = item.transform[4] ?? Number.NaN;
          return (
            !Number.isFinite(x) || x < pageLeft || x + item.width > pageRight
          );
        })
      ) {
        throw new TypeError("PDF text extends outside the actual page bounds");
      }
      const values = items.map((item) => item.str);
      const observedHeaders = values.slice(0, expected.headers.length);
      if (
        JSON.stringify(observedHeaders) !== JSON.stringify(expected.headers)
      ) {
        throw new TypeError("PDF content does not preserve the table schema");
      }
      const body = values.slice(expected.headers.length);
      if (body.length % expected.headers.length !== 0) {
        throw new TypeError("PDF content has an incomplete table row");
      }
      for (
        let index = 0;
        index < body.length;
        index += expected.headers.length
      ) {
        observedRows.push(body.slice(index, index + expected.headers.length));
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  if (JSON.stringify(observedRows) !== JSON.stringify(expected.rows)) {
    throw new TypeError("PDF content does not preserve every table row");
  }
}

async function verifyOutput(
  format: TableOutputFormat,
  bytes: Uint8Array,
  expectedTable?: TableData,
): Promise<TableData | undefined> {
  if (format === "pdf") {
    const document = await PDFDocument.load(bytes);
    if (document.getPageCount() < 1)
      throw new TypeError("PDF output requires a page");
    if (expectedTable) await verifyTablePdfOutput(bytes, expectedTable);
    return undefined;
  }
  if (format === "jsonlines") {
    const records = decoder
      .decode(bytes)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
    return recordsToTable(records, "JSONLines");
  }
  if (format === "excel") return parseExcel(bytes);
  return parseTableInput(format, bytes);
}

function createTableProcessor(
  from: TableInputFormat,
  to: TableOutputFormat,
): ToolProcessor<undefined> {
  const input = tableInputContracts[from];
  const output = tableOutputContracts[to];
  return {
    engine: verifiedTableEngine,
    support: defineToolSupport({
      acquisition: "file",
      inputs: [{ format: from, mimeTypes: input.mimeTypes }],
      outputs: [{ format: to, mimeType: output.mimeType }],
      resourceLimits: {
        maxInputBytes: 5_000_000,
        maxOutputBytes: 10_000_000,
        maxTotalOutputBytes: 10_000_000,
      },
      outputCardinality: { min: 1, max: 1 },
    }),
    parseOptions(options) {
      return options === undefined
        ? { ok: true, value: undefined }
        : { ok: false, message: "Table conversion does not accept options" };
    },
    decideSupport(request) {
      return request.requestedOperation === "table-convert"
        ? { supported: true }
        : { supported: false, message: "Unsupported table operation" };
    },
    async verifyInput(media) {
      try {
        const table = await parseTableInput(from, media.bytes);
        if (to === "pdf") await assertLosslessPdfLayout(table);
        if (
          to === "excel" &&
          table.rows.some((row) => row.every((cell) => cell === ""))
        ) {
          throw new TypeError(
            "An empty XLSX row cannot be preserved by the workbook reader",
          );
        }
        if (
          to === "pdf" &&
          [...table.headers, ...table.rows.flat()].some(
            (cell) => !isWinAnsiText(cell),
          )
        ) {
          throw new TypeError(
            "PDF table output currently accepts WinAnsi text only",
          );
        }
        return { status: "verified" };
      } catch (error) {
        return {
          status: "rejected",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async process(media) {
      const table = await parseTableInput(from, media.bytes);
      const bytes = await serializeTable(to, table);
      const verifiedTable = await verifyOutput(to, bytes, table);
      if (verifiedTable && !tableEquals(table, verifiedTable)) {
        throw new TypeError(`${to} output changed the table schema or rows`);
      }
      return [
        {
          name: `${media.name.replace(/\.[^.]+$/, "") || "table"}.${output.extension}`,
          format: to,
          mimeType: output.mimeType,
          bytes,
        },
      ];
    },
    async verifyResult(result) {
      try {
        await verifyOutput(to, result.bytes);
        return { status: "verified" };
      } catch (error) {
        return {
          status: "rejected",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function resolveTableProcessor(toolId: string): ToolProcessor | undefined {
  const policy = getTableOperationPolicy(toolId);
  return policy.kind === "eligible"
    ? createTableProcessor(policy.from, policy.to)
    : undefined;
}

export type TableOperationState =
  | Readonly<{
      kind: "supported";
      toolId: string;
      adapterId: "browser-table-converter";
      from: TableInputFormat;
      to: TableOutputFormat;
    }>
  | Readonly<{
      kind: "unsupported" | "unknown";
      toolId: string;
      reason: string;
      sourceNeeded: string;
    }>;

type TableProcessorResolver = (toolId: string) => ToolProcessor | undefined;

export function createTableOperationStateResolver(
  resolveProcessor: TableProcessorResolver,
): (toolId: string) => TableOperationState {
  return (toolId) => {
    const policy = getTableOperationPolicy(toolId);
    if (policy.kind !== "eligible") {
      return policy;
    }
    if (!resolveProcessor(toolId)) {
      return Object.freeze({
        kind: "unknown",
        toolId,
        reason:
          "The table output policy is eligible but no processor resolves.",
        sourceNeeded:
          "Register and test an exact processor before classifying this operation as supported.",
      });
    }
    return Object.freeze({
      kind: "supported",
      toolId,
      adapterId: "browser-table-converter",
      from: policy.from,
      to: policy.to,
    });
  };
}

export const getTableOperationState = createTableOperationStateResolver(
  resolveTableProcessor,
);

export function createTableToolWorkflow(
  ports: TableWorkflowPorts,
): ToolWorkflow {
  const resolveProcessor = (toolId: string) => resolveTableProcessor(toolId);
  return createToolWorkflow({
    acquisition: {
      file: {
        async acquire(input) {
          return input.media;
        },
      },
      url: {
        async acquire() {
          throw new TypeError(
            "Table conversion accepts files or pasted bytes only",
          );
        },
      },
    },
    resolveIntent(toolId) {
      const tool = toolCatalog.getById(toolId);
      if (
        getTableOperationState(toolId).kind !== "supported" ||
        !tool?.from ||
        !tool.to ||
        tool.content?.tool.renderer !== "table"
      ) {
        return undefined;
      }
      const processor = resolveProcessor(toolId);
      const output = processor?.support.outputs[0];
      return output
        ? defineToolExecutionIntent({
            requestedOperation: "table-convert",
            outputs: [output],
          })
        : undefined;
    },
    resolveProcessor(toolId) {
      return resolveProcessor(toolId);
    },
    async deliver(result) {
      return ports.deliver(result);
    },
    runtime: {
      async open() {
        return { release: async () => {} };
      },
    },
    telemetry: ports.telemetry,
    clock: ports.clock ?? { now: () => Date.now() },
    nextId: ports.nextId,
  });
}

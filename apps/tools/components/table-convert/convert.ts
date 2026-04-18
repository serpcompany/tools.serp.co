import Papa from "papaparse";
import { markdownTable } from "markdown-table";
import YAML from "yaml";
import { InputFormat, OutputFormat, TableData } from "./types";

type AnyFormat = InputFormat | OutputFormat;

type ParseResult = {
  table: TableData | null;
  supported: boolean;
  error?: string | null;
};

type SerializeResult = {
  text: string;
  supported: boolean;
  notice?: string;
};

function normalizeTable(headers: string[], rows: string[][]) {
  const maxColumns = Math.max(headers.length, ...rows.map((row) => row.length), 0);
  const safeHeaders = headers.length
    ? headers
    : Array.from({ length: maxColumns }, (_, index) => `column_${index + 1}`);
  const normalizedRows = rows.map((row) =>
    safeHeaders.map((_, index) => (row[index] ?? "").toString())
  );
  return { headers: safeHeaders, rows: normalizedRows };
}

export function tableDataToObjects(table: TableData) {
  return table.rows.map((row) => {
    const output: Record<string, string> = {};
    table.headers.forEach((header, index) => {
      output[header] = row[index] ?? "";
    });
    return output;
  });
}

export function objectsToTableData(list: Array<Record<string, unknown>>) {
  const headerSet = new Set<string>();
  list.forEach((item) => {
    Object.keys(item).forEach((key) => headerSet.add(key));
  });
  const headers = Array.from(headerSet);
  const rows = list.map((item) =>
    headers.map((header) => {
      const value = item[header];
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    })
  );
  return normalizeTable(headers, rows);
}

function parseCsv(text: string) {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  if (parsed.errors.length) {
    return { table: null, error: parsed.errors[0]?.message ?? "CSV parse error" };
  }
  const data = parsed.data as string[][];
  const headerRow = data[0];
  if (!headerRow) {
    return { table: null, error: "CSV is empty." };
  }
  const rows = data.slice(1);
  return { table: normalizeTable(headerRow, rows), error: null };
}

function parseJson(text: string) {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { table: null, error: "JSON array is empty." };
    }
    if (parsed.every((row) => Array.isArray(row))) {
      const rows = parsed as unknown[][];
      const firstRow = rows[0] as unknown[];
      const allStrings = firstRow.every((cell) => typeof cell === "string");
      const maxColumns = Math.max(...rows.map((row) => row.length));
      const headers = allStrings
        ? firstRow.map((cell) => String(cell))
        : Array.from({ length: maxColumns }, (_, index) => `column_${index + 1}`);
      const dataRows = allStrings
        ? rows.slice(1).map((row) => row.map((cell) => (cell ?? "").toString()))
        : rows.map((row) => row.map((cell) => (cell ?? "").toString()));
      return { table: normalizeTable(headers, dataRows), error: null };
    }
    if (parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return {
        table: objectsToTableData(parsed as Array<Record<string, unknown>>),
        error: null,
      };
    }
  }
  return { table: null, error: "JSON must be an array of objects or arrays." };
}

function splitMarkdownRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownDivider(line: string) {
  const cells = splitMarkdownRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdown(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { table: null, error: "Markdown table needs a header and separator line." };
  }
  const headerLine = lines[0];
  const dividerLine = lines[1];
  if (!headerLine || !dividerLine) {
    return { table: null, error: "Markdown table needs a header and separator line." };
  }
  const headerRow = splitMarkdownRow(headerLine);
  const dividerIndex = isMarkdownDivider(dividerLine) ? 2 : 1;
  const rows = lines.slice(dividerIndex).map(splitMarkdownRow);
  return { table: normalizeTable(headerRow, rows), error: null };
}

function parseHtml(text: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");
  const table = doc.querySelector("table");
  if (!table) {
    return { table: null, error: "No <table> found in HTML." };
  }
  const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th, td")).map((cell) =>
      (cell.textContent ?? "").trim()
    )
  );
  const headerRow = rows[0];
  if (!headerRow) {
    return { table: null, error: "HTML table is empty." };
  }
  const bodyRows = rows.slice(1);
  return { table: normalizeTable(headerRow, bodyRows), error: null };
}

function parseXml(text: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    return { table: null, error: "XML parse error." };
  }
  let rowNodes = Array.from(doc.querySelectorAll("row"));
  if (!rowNodes.length && doc.documentElement) {
    rowNodes = Array.from(doc.documentElement.children);
  }
  if (!rowNodes.length) {
    return { table: null, error: "XML needs <row> elements." };
  }
  const headersSet = new Set<string>();
  const rowMaps = rowNodes.map((node) => {
    const map: Record<string, string> = {};
    Array.from(node.children).forEach((child) => {
      const key = child.tagName;
      headersSet.add(key);
      map[key] = (child.textContent ?? "").trim();
    });
    return map;
  });
  const headers = Array.from(headersSet);
  const rows = rowMaps.map((row) => headers.map((header) => row[header] ?? ""));
  return { table: normalizeTable(headers, rows), error: null };
}

function parseYaml(text: string) {
  const parsed = YAML.parse(text) as unknown;
  if (Array.isArray(parsed)) {
    if (!parsed.length) {
      return { table: null, error: "YAML array is empty." };
    }
    if (parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return {
        table: objectsToTableData(parsed as Array<Record<string, unknown>>),
        error: null,
      };
    }
  }
  return { table: null, error: "YAML must be a list of objects." };
}

function parseInsertStatement(text: string) {
  const match = text.match(
    /insert\s+into\s+[`"\w.-]+\s*\(([^)]+)\)\s*values\s*([\s\S]+?);?\s*$/i
  );
  if (!match) {
    return { table: null, error: "SQL INSERT with column list is required." };
  }
  const headerPart = match[1];
  const valuesPart = match[2];
  const headers = headerPart
    .split(",")
    .map((header) => header.trim().replace(/^[`"]|[`"]$/g, ""))
    .filter(Boolean);
  if (!headers.length) {
    return { table: null, error: "SQL INSERT must include columns." };
  }
  const rows = parseSqlValueTuples(valuesPart);
  if (!rows.length) {
    return { table: null, error: "SQL INSERT must include VALUES rows." };
  }
  return { table: normalizeTable(headers, rows), error: null };
}

function parseSqlValueTuples(text: string) {
  const rows: string[][] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "(") {
      index += 1;
      continue;
    }
    let depth = 1;
    let cursor = index + 1;
    let inString = false;
    let quoteChar = "";
    let rowText = "";
    while (cursor < text.length && depth > 0) {
      const char = text[cursor];
      if (inString) {
        if (char === "\\" && cursor + 1 < text.length) {
          rowText += text[cursor + 1];
          cursor += 2;
          continue;
        }
        if (char === quoteChar) {
          if (quoteChar === "'" && text[cursor + 1] === "'") {
            rowText += "'";
            cursor += 2;
            continue;
          }
          inString = false;
          cursor += 1;
          continue;
        }
        rowText += char;
        cursor += 1;
        continue;
      }
      if (char === "'" || char === "\"") {
        inString = true;
        quoteChar = char;
        cursor += 1;
        continue;
      }
      if (char === "(") {
        depth += 1;
        rowText += char;
        cursor += 1;
        continue;
      }
      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          cursor += 1;
          break;
        }
        rowText += char;
        cursor += 1;
        continue;
      }
      rowText += char;
      cursor += 1;
    }
    if (rowText.trim()) {
      rows.push(parseSqlRowValues(rowText));
    }
    index = cursor;
  }
  return rows;
}

function parseSqlRowValues(rowText: string) {
  const values: string[] = [];
  let current = "";
  let inString = false;
  let quoteChar = "";
  for (let i = 0; i < rowText.length; i += 1) {
    const char = rowText[i];
    if (inString) {
      if (char === "\\" && i + 1 < rowText.length) {
        current += rowText[i + 1];
        i += 1;
        continue;
      }
      if (char === quoteChar) {
        if (quoteChar === "'" && rowText[i + 1] === "'") {
          current += "'";
          i += 1;
          continue;
        }
        inString = false;
        continue;
      }
      current += char;
      continue;
    }
    if (char === "'" || char === "\"") {
      inString = true;
      quoteChar = char;
      continue;
    }
    if (char === ",") {
      values.push(normalizeSqlValue(current));
      current = "";
      continue;
    }
    current += char;
  }
  values.push(normalizeSqlValue(current));
  return values;
}

function normalizeSqlValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "null") return "";
  return trimmed;
}

function parseSql(text: string) {
  return parseInsertStatement(text);
}

function parseMySql(text: string) {
  const tableResult = parseMySqlTable(text);
  if (tableResult.table) {
    return tableResult;
  }
  return parseInsertStatement(text);
}

function parseMySqlTable(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (!lines.length) {
    return { table: null, error: "MySQL table output is missing row data." };
  }
  const parsedRows = lines.map((line) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim())
  );
  const headerRow = parsedRows[0];
  const bodyRows = parsedRows.slice(1);
  if (!headerRow || !headerRow.length) {
    return { table: null, error: "MySQL table output needs headers." };
  }
  return { table: normalizeTable(headerRow, bodyRows), error: null };
}

function parseLatex(text: string) {
  const match = text.match(/\\begin\{tabular\}[\s\S]*?\}([\s\S]*?)\\end\{tabular\}/);
  const content = match?.[1] ?? text;
  const rows = content
    .split(/\\\\/)
    .map((row) => row.replace(/\\hline/g, "").trim())
    .filter(Boolean)
    .map((row) => row.split("&").map((cell) => unescapeLatex(cell.trim())));
  const headerRow = rows[0];
  if (!headerRow) {
    return { table: null, error: "LaTeX tabular is empty." };
  }
  const bodyRows = rows.slice(1);
  return { table: normalizeTable(headerRow, bodyRows), error: null };
}

function parseMediaWiki(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const contentLines = [];
  let insideTable = false;
  for (const line of lines) {
    if (line.startsWith("{|")) {
      insideTable = true;
      continue;
    }
    if (line.startsWith("|}")) {
      insideTable = false;
      continue;
    }
    if (insideTable) {
      contentLines.push(line);
    }
  }
  const workLines = contentLines.length ? contentLines : lines;
  const headers: string[] = [];
  const rows: string[][] = [];
  let currentRow: string[] | null = null;
  for (const line of workLines) {
    if (!line) continue;
    if (line.startsWith("|-")) {
      if (currentRow) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }
    if (line.startsWith("!")) {
      const headerCells = splitMediaWikiCells(line.slice(1), "!!");
      headers.push(...headerCells);
      currentRow = null;
      continue;
    }
    if (line.startsWith("|")) {
      const cells = splitMediaWikiCells(line.slice(1), "||");
      if (!currentRow) currentRow = [];
      currentRow.push(...cells);
    }
  }
  if (currentRow) {
    rows.push(currentRow);
  }
  if (!headers.length && rows.length) {
    headers.push(...rows[0].map((_, index) => `column_${index + 1}`));
  }
  if (!headers.length) {
    return { table: null, error: "MediaWiki table needs headers or rows." };
  }
  return { table: normalizeTable(headers, rows), error: null };
}

function splitMediaWikiCells(line: string, separator: string) {
  const rawCells = line.includes(separator) ? line.split(separator) : line.split("|");
  return rawCells.map((cell) => {
    const trimmed = cell.trim();
    if (!trimmed) return "";
    if (trimmed.includes("|")) {
      return trimmed.split("|").pop()?.trim() ?? "";
    }
    return trimmed;
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeSql(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function escapeSqlIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

function escapeLatex(value: string) {
  return value.replace(/([&%$#_{}~^\\])/g, "\\$1");
}

function unescapeLatex(value: string) {
  return value
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\\$/g, "$")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\textbackslash\{\}/g, "\\");
}

function escapeMediaWiki(value: string) {
  return value.replace(/\|/g, "&#124;").replace(/\n/g, "<br />");
}

function escapeDoubleQuotes(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeSingleQuotes(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeDaxString(value: string) {
  return value.replace(/"/g, '""');
}

function escapeMatlabString(value: string) {
  return value.replace(/'/g, "''");
}

function escapeRdfLiteral(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeIdentifier(value: string, fallback: string) {
  const trimmed = value.trim();
  const replaced = trimmed.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!replaced) return fallback;
  if (/^[0-9]/.test(replaced)) return `col_${replaced}`;
  return replaced;
}

function buildFixedWidthTable(table: TableData, headerSeparator = "-") {
  const rows = [table.headers, ...table.rows];
  const widths = table.headers.map((_, index) =>
    Math.max(...rows.map((row) => (row[index] ?? "").toString().length), 0)
  );
  const makeLine = (char: string) =>
    `+${widths.map((width) => char.repeat(width + 2)).join("+")}+`;
  const makeRow = (row: string[]) =>
    `| ${row
      .map((cell, index) => (cell ?? "").toString().padEnd(widths[index] ?? 0))
      .join(" | ")} |`;

  const lines = [makeLine("-"), makeRow(table.headers), makeLine(headerSeparator)];
  for (const row of table.rows) {
    lines.push(makeRow(row));
  }
  lines.push(makeLine("-"));
  return lines.join("\n");
}

function buildAsciiDocTable(table: TableData) {
  const lines = ["|==="];
  lines.push(`| ${table.headers.join(" | ")}`);
  table.rows.forEach((row) => {
    lines.push(`| ${row.join(" | ")}`);
  });
  lines.push("|===");
  return lines.join("\n");
}

function buildBBCodeTable(table: TableData) {
  const lines = ["[table]"];
  lines.push(`[tr]${table.headers.map((h) => `[th]${h}[/th]`).join("")}[/tr]`);
  table.rows.forEach((row) => {
    lines.push(`[tr]${row.map((cell) => `[td]${cell}[/td]`).join("")}[/tr]`);
  });
  lines.push("[/table]");
  return lines.join("\n");
}

function buildJiraTable(table: TableData) {
  const lines = [`|| ${table.headers.join(" || ")} ||`];
  table.rows.forEach((row) => {
    lines.push(`| ${row.join(" | ")} |`);
  });
  return lines.join("\n");
}

function buildTextileTable(table: TableData) {
  const lines = [`|_. ${table.headers.join(" |_. ")} |`];
  table.rows.forEach((row) => {
    lines.push(`| ${row.join(" | ")} |`);
  });
  return lines.join("\n");
}

function buildTracWikiTable(table: TableData) {
  return buildJiraTable(table);
}

function buildIni(table: TableData) {
  const lines: string[] = [];
  table.rows.forEach((row, index) => {
    lines.push(`[row_${index + 1}]`);
    table.headers.forEach((header, headerIndex) => {
      const key = normalizeIdentifier(header, `column_${headerIndex + 1}`);
      const value = row[headerIndex] ?? "";
      lines.push(`${key}=${value}`);
    });
    lines.push("");
  });
  return lines.join("\n").trim();
}

function buildToml(table: TableData) {
  const lines: string[] = [];
  table.rows.forEach((row) => {
    lines.push("[[rows]]");
    table.headers.forEach((header, headerIndex) => {
      const key = normalizeIdentifier(header, `column_${headerIndex + 1}`);
      const value = escapeDoubleQuotes(row[headerIndex] ?? "");
      lines.push(`${key} = "${value}"`);
    });
    lines.push("");
  });
  return lines.join("\n").trim();
}

function buildPhpArray(table: TableData) {
  const lines = ["<?php", "return ["];
  table.rows.forEach((row) => {
    const pairs = table.headers.map((header, index) => {
      const key = escapeSingleQuotes(header);
      const value = escapeSingleQuotes(row[index] ?? "");
      return `'${key}' => '${value}'`;
    });
    lines.push(`  [${pairs.join(", ")}],`);
  });
  lines.push("];");
  return lines.join("\n");
}

function buildRubyArray(table: TableData) {
  const lines = ["["];
  table.rows.forEach((row) => {
    const pairs = table.headers.map((header, index) => {
      const key = escapeSingleQuotes(header);
      const value = escapeSingleQuotes(row[index] ?? "");
      return `'${key}' => '${value}'`;
    });
    lines.push(`  { ${pairs.join(", ")} },`);
  });
  lines.push("]");
  return lines.join("\n");
}

function buildActionScriptArray(table: TableData) {
  const lines = ["var data:Array = ["];
  table.rows.forEach((row) => {
    const pairs = table.headers.map((header, index) => {
      const key = escapeDoubleQuotes(header);
      const value = escapeDoubleQuotes(row[index] ?? "");
      return `"${key}": "${value}"`;
    });
    lines.push(`  { ${pairs.join(", ")} },`);
  });
  lines.push("];");
  return lines.join("\n");
}

function buildAspArray(table: TableData) {
  const rows: string[] = [];
  const headerRow = table.headers.map((header) => `"${escapeDoubleQuotes(header)}"`);
  rows.push(`  Array(${headerRow.join(", ")})`);
  table.rows.forEach((row) => {
    const values = row.map((cell) => `"${escapeDoubleQuotes(cell ?? "")}"`);
    rows.push(`  Array(${values.join(", ")})`);
  });
  const lines = ["data = Array(", rows.join(",\n"), ")"];
  return lines.join("\n");
}

function buildMatlabTable(table: TableData) {
  const columns = table.headers.map((header, index) => {
    const values = table.rows.map((row) => `'${escapeMatlabString(row[index] ?? "")}'`);
    return `{${values.join("; ")}}`;
  });
  const headers = table.headers.map((header) => `'${escapeMatlabString(header)}'`);
  return [
    `T = table(${columns.join(", ")}, 'VariableNames', {${headers.join(", ")}});`,
  ].join("\n");
}

function buildPandasDataFrame(table: TableData) {
  const data = JSON.stringify(tableDataToObjects(table), null, 2);
  return [
    "import pandas as pd",
    "",
    `data = ${data}`,
    "df = pd.DataFrame(data)",
  ].join("\n");
}

function buildRDataFrame(table: TableData) {
  const columns = table.headers.map((header, index) => {
    const key = normalizeIdentifier(header, `column_${index + 1}`);
    const values = table.rows.map((row) => `"${escapeDoubleQuotes(row[index] ?? "")}"`);
    return `  ${key} = c(${values.join(", ")})`;
  });
  return [
    "df <- data.frame(",
    columns.join(",\n"),
    ",\n  stringsAsFactors = FALSE\n)",
  ].join("");
}

function buildDaxTable(table: TableData) {
  const headerDefs = table.headers
    .map((header) => `"${escapeDaxString(header)}", STRING`)
    .join(", ");
  const rows = table.rows
    .map(
      (row) => `{ ${row.map((cell) => `"${escapeDaxString(cell ?? "")}"`).join(", ")} }`
    )
    .join(",\n  ");
  return `DATATABLE(${headerDefs}, {\n  ${rows}\n})`;
}

function buildQlikInline(table: TableData) {
  const lines = ["LOAD * INLINE [", table.headers.join(",")];
  table.rows.forEach((row) => {
    lines.push(row.map((cell) => (cell ?? "")).join(","));
  });
  lines.push("];");
  return lines.join("\n");
}

function buildFirebaseJson(table: TableData) {
  return JSON.stringify(tableDataToObjects(table), null, 2);
}

function buildRdfTriples(table: TableData) {
  const lines: string[] = [];
  table.rows.forEach((row, rowIndex) => {
    const subject = `_:row${rowIndex + 1}`;
    table.headers.forEach((header, colIndex) => {
      const predicate = normalizeIdentifier(header, `column_${colIndex + 1}`);
      const value = escapeRdfLiteral(row[colIndex] ?? "");
      lines.push(`${subject} <urn:table:${predicate}> "${value}" .`);
    });
  });
  return lines.join("\n");
}

export function serializeOutput(format: AnyFormat, table: TableData): SerializeResult {
  switch (format) {
    case "csv":
      return {
        text: Papa.unparse({ fields: table.headers, data: table.rows }),
        supported: true,
      };
    case "json":
      return {
        text: JSON.stringify(tableDataToObjects(table), null, 2),
        supported: true,
      };
    case "markdown":
      return {
        text: markdownTable([table.headers, ...table.rows]),
        supported: true,
      };
    case "html":
      return {
        text: [
          "<table>",
          "  <thead>",
          `    <tr>${table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`,
          "  </thead>",
          "  <tbody>",
          ...table.rows.map(
            (row) =>
              `    <tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
          ),
          "  </tbody>",
          "</table>",
        ].join("\n"),
        supported: true,
      };
    case "xml":
      return {
        text: [
          "<rows>",
          ...table.rows.map((row) => {
            const cells = row
              .map(
                (cell, index) =>
                  `    <${table.headers[index]}>${escapeXml(cell)}</${table.headers[index]}>`
              )
              .join("\n");
            return `  <row>\n${cells}\n  </row>`;
          }),
          "</rows>",
        ].join("\n"),
        supported: true,
      };
    case "yaml":
      return {
        text: YAML.stringify(tableDataToObjects(table)),
        supported: true,
      };
    case "sql":
      return {
        text: [
          `INSERT INTO table_name (${table.headers.join(", ")}) VALUES`,
          ...table.rows.map((row, index) => {
            const values = row.map((cell) => escapeSql(cell)).join(", ");
            const suffix = index === table.rows.length - 1 ? ";" : ",";
            return `  (${values})${suffix}`;
          }),
        ].join("\n"),
        supported: true,
      };
    case "mysql":
      return {
        text: [
          `INSERT INTO ${escapeSqlIdentifier("table_name")} (${table.headers
            .map(escapeSqlIdentifier)
            .join(", ")}) VALUES`,
          ...table.rows.map((row, index) => {
            const values = row.map((cell) => escapeSql(cell)).join(", ");
            const suffix = index === table.rows.length - 1 ? ";" : ",";
            return `  (${values})${suffix}`;
          }),
        ].join("\n"),
        supported: true,
      };
    case "latex":
      return {
        text: [
          `\\begin{tabular}{${"l".repeat(table.headers.length)}}`,
          `${table.headers.map(escapeLatex).join(" & ")} \\\\`,
          "\\hline",
          ...table.rows.map((row) => `${row.map(escapeLatex).join(" & ")} \\\\`),
          "\\end{tabular}",
        ].join("\n"),
        supported: true,
      };
    case "mediawiki":
      return {
        text: [
          '{| class="wikitable"',
          `! ${table.headers.map(escapeMediaWiki).join(" !! ")}`,
          ...table.rows.flatMap((row) => [
            "|-",
            `| ${row.map(escapeMediaWiki).join(" || ")}`,
          ]),
          "|}",
        ].join("\n"),
        supported: true,
      };
    case "ascii":
      return {
        text: buildFixedWidthTable(table, "-"),
        supported: true,
      };
    case "restructuredtext":
      return {
        text: buildFixedWidthTable(table, "="),
        supported: true,
      };
    case "asciidoc":
      return {
        text: buildAsciiDocTable(table),
        supported: true,
      };
    case "bbcode":
      return {
        text: buildBBCodeTable(table),
        supported: true,
      };
    case "jira":
      return {
        text: buildJiraTable(table),
        supported: true,
      };
    case "textile":
      return {
        text: buildTextileTable(table),
        supported: true,
      };
    case "tracwiki":
      return {
        text: buildTracWikiTable(table),
        supported: true,
      };
    case "jsonlines":
      return {
        text: tableDataToObjects(table).map((row) => JSON.stringify(row)).join("\n"),
        supported: true,
      };
    case "ini":
      return {
        text: buildIni(table),
        supported: true,
      };
    case "toml":
      return {
        text: buildToml(table),
        supported: true,
      };
    case "php":
      return {
        text: buildPhpArray(table),
        supported: true,
      };
    case "ruby":
      return {
        text: buildRubyArray(table),
        supported: true,
      };
    case "actionscript":
      return {
        text: buildActionScriptArray(table),
        supported: true,
      };
    case "asp":
      return {
        text: buildAspArray(table),
        supported: true,
      };
    case "matlab":
      return {
        text: buildMatlabTable(table),
        supported: true,
      };
    case "pandasdataframe":
      return {
        text: buildPandasDataFrame(table),
        supported: true,
      };
    case "rdataframe":
      return {
        text: buildRDataFrame(table),
        supported: true,
      };
    case "dax":
      return {
        text: buildDaxTable(table),
        supported: true,
      };
    case "qlik":
      return {
        text: buildQlikInline(table),
        supported: true,
      };
    case "firebase":
      return {
        text: buildFirebaseJson(table),
        supported: true,
      };
    case "rdf":
      return {
        text: buildRdfTriples(table),
        supported: true,
      };
    case "avro":
    case "protobuf":
    case "magic":
    case "excel":
    case "pdf":
    case "png":
    case "jpeg":
      return {
        text: `Binary output placeholder for ${format.toUpperCase()}.`,
        supported: false,
        notice: `${format.toUpperCase()} output is not wired yet in the demo.`,
      };
    default:
      return {
        text: `Format ${format} is not wired yet.`,
        supported: false,
        notice: `Format ${format} is not wired yet.`,
      };
  }
}

export function parseInput(format: InputFormat, text: string): ParseResult {
  if (!text.trim()) {
    return { table: null, supported: true, error: "Paste or upload data to begin." };
  }
  try {
    switch (format) {
      case "csv":
        return { ...parseCsv(text), supported: true };
      case "json":
        return { ...parseJson(text), supported: true };
      case "markdown":
        return { ...parseMarkdown(text), supported: true };
      case "html":
        return { ...parseHtml(text), supported: true };
      case "xml":
        return { ...parseXml(text), supported: true };
      case "yaml":
        return { ...parseYaml(text), supported: true };
      case "sql":
        return { ...parseSql(text), supported: true };
      case "latex":
        return { ...parseLatex(text), supported: true };
      case "excel":
        return {
          table: null,
          supported: false,
          error: `${format.toUpperCase()} input parsing is not wired yet.`,
        };
      case "mysql":
        return { ...parseMySql(text), supported: true };
      case "mediawiki":
        return { ...parseMediaWiki(text), supported: true };
      default:
        return { table: null, supported: false, error: "Unsupported input format." };
    }
  } catch (error) {
    return {
      table: null,
      supported: true,
      error: error instanceof Error ? error.message : "Parse error",
    };
  }
}

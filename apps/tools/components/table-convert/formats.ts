import type { FormatOption, InputFormat, OutputFormat, TableData } from "./types.ts";

export const INPUT_FORMATS: FormatOption[] = [
  { value: "csv", label: "CSV" },
  { value: "excel", label: "Excel" },
  { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" },
  { value: "html", label: "HTML" },
  { value: "sql", label: "SQL" },
  { value: "latex", label: "LaTeX" },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML" },
  { value: "mysql", label: "MySQL" },
  { value: "mediawiki", label: "MediaWiki" },
];

export const OUTPUT_FORMATS: FormatOption[] = [
  { value: "json", label: "JSON" },
  { value: "jsonlines", label: "JSONLines" },
  { value: "csv", label: "CSV" },
  { value: "markdown", label: "Markdown" },
  { value: "html", label: "HTML" },
  { value: "sql", label: "SQL" },
  { value: "mysql", label: "MySQL" },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML" },
  { value: "latex", label: "LaTeX" },
  { value: "mediawiki", label: "MediaWiki" },
  { value: "ascii", label: "ASCII" },
  { value: "asciidoc", label: "AsciiDoc" },
  { value: "bbcode", label: "BBCode" },
  { value: "jira", label: "Jira" },
  { value: "textile", label: "Textile" },
  { value: "tracwiki", label: "TracWiki" },
  { value: "restructuredtext", label: "reStructuredText" },
  { value: "ini", label: "INI" },
  { value: "toml", label: "TOML" },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby" },
  { value: "actionscript", label: "ActionScript" },
  { value: "asp", label: "ASP" },
  { value: "matlab", label: "MATLAB" },
  { value: "pandasdataframe", label: "Pandas DataFrame" },
  { value: "rdataframe", label: "R DataFrame" },
  { value: "dax", label: "DAX" },
  { value: "qlik", label: "Qlik" },
  { value: "firebase", label: "Firebase" },
  { value: "rdf", label: "RDF" },
  { value: "avro", label: "Avro" },
  { value: "protobuf", label: "Protobuf" },
  { value: "excel", label: "Excel" },
  { value: "pdf", label: "PDF" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
];

// What each output saves as: the file extension and its media type. A format
// with no usual extension of its own saves as .txt.
const TEXT = "text/plain";
export const OUTPUT_FILE_TYPES: Record<OutputFormat, { extension: string; mimeType: string }> = {
  json: { extension: "json", mimeType: "application/json" },
  jsonlines: { extension: "jsonl", mimeType: "application/jsonl" },
  csv: { extension: "csv", mimeType: "text/csv" },
  markdown: { extension: "md", mimeType: "text/markdown" },
  html: { extension: "html", mimeType: "text/html" },
  sql: { extension: "sql", mimeType: "application/sql" },
  mysql: { extension: "sql", mimeType: "application/sql" },
  xml: { extension: "xml", mimeType: "application/xml" },
  yaml: { extension: "yaml", mimeType: "application/yaml" },
  latex: { extension: "tex", mimeType: "application/x-tex" },
  // The extension this page reads back as MediaWiki.
  mediawiki: { extension: "wiki", mimeType: TEXT },
  ascii: { extension: "txt", mimeType: TEXT },
  asciidoc: { extension: "adoc", mimeType: TEXT },
  bbcode: { extension: "txt", mimeType: TEXT },
  jira: { extension: "txt", mimeType: TEXT },
  textile: { extension: "textile", mimeType: TEXT },
  tracwiki: { extension: "txt", mimeType: TEXT },
  restructuredtext: { extension: "rst", mimeType: "text/x-rst" },
  ini: { extension: "ini", mimeType: TEXT },
  toml: { extension: "toml", mimeType: "application/toml" },
  php: { extension: "php", mimeType: "application/x-httpd-php" },
  ruby: { extension: "rb", mimeType: "text/x-ruby" },
  actionscript: { extension: "as", mimeType: TEXT },
  asp: { extension: "asp", mimeType: TEXT },
  matlab: { extension: "m", mimeType: "text/x-matlab" },
  pandasdataframe: { extension: "py", mimeType: "text/x-python" },
  rdataframe: { extension: "R", mimeType: "text/x-r" },
  dax: { extension: "dax", mimeType: TEXT },
  // A Qlik load script.
  qlik: { extension: "qvs", mimeType: TEXT },
  firebase: { extension: "json", mimeType: "application/json" },
  // N-Triples.
  rdf: { extension: "nt", mimeType: "application/n-triples" },
  avro: { extension: "avro", mimeType: "application/avro" },
  protobuf: { extension: "pb", mimeType: "application/x-protobuf" },
  excel: { extension: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pdf: { extension: "pdf", mimeType: "application/pdf" },
  png: { extension: "png", mimeType: "image/png" },
  jpeg: { extension: "jpeg", mimeType: "image/jpeg" },
};

// Outputs written as files by lib/convert/table-outputs.ts rather than as
// text in the output panel.
export const BINARY_OUTPUT_FORMATS: ReadonlySet<OutputFormat> = new Set([
  "avro",
  "protobuf",
  "excel",
  "pdf",
  "png",
  "jpeg",
]);

export function isBinaryOutput(format: OutputFormat): boolean {
  return BINARY_OUTPUT_FORMATS.has(format);
}

// The media type a download is saved with; text is UTF-8.
export function outputMimeType(format: OutputFormat): string {
  const { mimeType } = OUTPUT_FILE_TYPES[format];
  return isBinaryOutput(format) ? mimeType : `${mimeType};charset=utf-8`;
}

// A download is named after the uploaded file (sales.csv saves as
// sales.json), or "table" for pasted text. `extension` overrides the
// format's, as for the .proto saved beside a .pb.
export function outputFileName(sourceName: string | null, format: OutputFormat, extension?: string): string {
  const base = (sourceName ?? "").replace(/\.[^.]*$/, "").trim() || "table";
  return `${base}.${extension ?? OUTPUT_FILE_TYPES[format].extension}`;
}

export const SAMPLE_TABLE: TableData = {
  headers: Array.from({ length: 10 }, (_, index) => `Column ${index + 1}`),
  rows: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => "")),
};

export function getLabel(list: FormatOption[], value: string) {
  return list.find((item) => item.value === value)?.label ?? value;
}

export function getPlaceholder(format: InputFormat) {
  switch (format) {
    case "csv":
      return "Paste CSV data or drop a .csv file";
    case "json":
      return "Paste a JSON array of objects or arrays";
    case "markdown":
      return "Paste a Markdown table";
    case "html":
      return "Paste HTML with a <table> element";
    case "xml":
      return "Paste XML with <row> elements";
    case "yaml":
      return "Paste YAML list of objects";
    case "sql":
      return "Paste SQL INSERT data";
    case "latex":
      return "Paste LaTeX tabular";
    case "excel":
      return "Upload an Excel workbook (.xlsx), or paste cells copied from Excel";
    case "mysql":
      return "Paste MySQL output";
    case "mediawiki":
      return "Paste MediaWiki table markup";
    default:
      return "Paste table data";
  }
}

export function detectFormatFromFile(file: File): InputFormat | null {
  const mime = file.type.toLowerCase();
  if (mime === "text/csv") return "csv";
  if (mime === "application/json") return "json";
  if (mime === "text/markdown") return "markdown";
  if (mime === "text/html") return "html";
  if (mime === "application/xml" || mime === "text/xml") return "xml";
  if (mime === "application/x-yaml" || mime === "text/yaml") return "yaml";
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (["csv", "tsv"].includes(ext)) return "csv";
  if (["json"].includes(ext)) return "json";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["html", "htm"].includes(ext)) return "html";
  if (["xml"].includes(ext)) return "xml";
  if (["yaml", "yml"].includes(ext)) return "yaml";
  if (["sql"].includes(ext)) return "sql";
  if (["tex"].includes(ext)) return "latex";
  if (["xls", "xlsx"].includes(ext)) return "excel";
  if (["wiki", "mediawiki"].includes(ext)) return "mediawiki";
  return null;
}

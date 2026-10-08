import { FormatOption, InputFormat, TableData } from "./types";

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
      return "Upload an Excel file (.xlsx, .xls)";
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

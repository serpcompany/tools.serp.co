import type { Metadata } from "next";

import { FREE, composeDescription, pageMetadata } from "./page-metadata.ts";
import { normalizePath } from "./sitemap.ts";

const TABLE_CONVERT_LABELS: Record<string, string> = {
  csv: "CSV",
  json: "JSON",
  jsonlines: "JSONLines",
  markdown: "Markdown",
  html: "HTML",
  xml: "XML",
  yaml: "YAML",
  sql: "SQL",
  mysql: "MySQL",
  latex: "LaTeX",
  mediawiki: "MediaWiki",
  ascii: "ASCII",
  asciidoc: "AsciiDoc",
  actionscript: "ActionScript",
  asp: "ASP",
  avro: "Avro",
  bbcode: "BBCode",
  dax: "DAX",
  excel: "Excel",
  firebase: "Firebase",
  ini: "INI",
  jira: "Jira",
  jpeg: "JPEG",
  pdf: "PDF",
  png: "PNG",
  matlab: "MATLAB",
  pandasdataframe: "Pandas DataFrame",
  php: "PHP",
  protobuf: "Protobuf",
  qlik: "Qlik",
  rdataframe: "R DataFrame",
  rdf: "RDF",
  restructuredtext: "reStructuredText",
  ruby: "Ruby",
  textile: "Textile",
  toml: "TOML",
  tracwiki: "TracWiki",
};

export const formatTableLabel = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return TABLE_CONVERT_LABELS[normalized] ?? normalized.toUpperCase();
};

type TableConvertMetadataInput = {
  from: string;
  to: string;
  title: string;
  slug: string;
};

// TableConvertLanding converts in the page, Excel workbooks included (read in
// a web worker), and sends the table nowhere.
const TABLE_IN_BROWSER = "It runs in your browser, so your data stays on your device.";

export function buildTableConvertMetadata({
  from,
  to,
  title,
  slug,
}: TableConvertMetadataInput): Metadata {
  const fromLabel = formatTableLabel(from);
  const toLabel = formatTableLabel(to);
  const description = composeDescription(
    `Convert ${fromLabel} to ${toLabel} online with a live table preview.`,
    [
      TABLE_IN_BROWSER,
      FREE,
      `Paste or drop in your ${fromLabel} data, then download the ${toLabel} result.`,
    ],
  );

  return pageMetadata({
    title,
    description,
    canonical: normalizePath(slug),
    image: "convert",
  });
}

// /table-convert-demo/, the table converter with every input and output
// format, which TableConvertLanding pages fix to one pair.
export function buildTableConvertDemoMetadata(): Metadata {
  return pageMetadata({
    title: "Table Converter Demo",
    description:
      "Paste or upload a table as CSV, Excel, JSON, Markdown, HTML or SQL, convert it to another format and preview both side by side, in your browser.",
    canonical: normalizePath("/table-convert-demo/"),
    image: "convert",
  });
}

import { toolCatalog } from "@serp-tools/app-core/lib/tool-catalog";

export const TABLE_PROCESSOR_ADAPTER_ID = "browser-table-converter";

type CodecImplementation = Readonly<
  | { class: "library" | "platform-primitive"; identity: string }
  | { class: "repository-authored"; identity: string; rationale: string }
>;

function library(identity: string): CodecImplementation {
  return Object.freeze({ class: "library", identity });
}

function platform(identity: string): CodecImplementation {
  return Object.freeze({ class: "platform-primitive", identity });
}

function repository(identity: string, rationale: string): CodecImplementation {
  return Object.freeze({ class: "repository-authored", identity, rationale });
}

export const tableInputContracts = Object.freeze({
  csv: Object.freeze({
    mimeTypes: Object.freeze(["text/csv"]),
    parser: library("Papa Parse 5"),
  }),
  excel: Object.freeze({
    mimeTypes: Object.freeze([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
    parser: library("read-excel-file 9"),
  }),
  html: Object.freeze({
    mimeTypes: Object.freeze(["text/html"]),
    parser: library("parse5 8"),
  }),
  json: Object.freeze({
    mimeTypes: Object.freeze(["application/json"]),
    parser: platform("JSON.parse"),
  }),
  latex: Object.freeze({
    mimeTypes: Object.freeze(["text/x-tex"]),
    parser: repository(
      "bounded tabular parser",
      "The supported contract is deliberately limited to one plain tabular environment; a focused state machine preserves escaped delimiters without accepting general TeX execution.",
    ),
  }),
  markdown: Object.freeze({
    mimeTypes: Object.freeze(["text/markdown"]),
    parser: repository(
      "bounded GFM table parser",
      "The maintained markdown-table dependency only serializes; the input contract is limited to a GFM header, divider, and escaped pipe rows and is covered by semantic round-trip fixtures.",
    ),
  }),
  mediawiki: Object.freeze({
    mimeTypes: Object.freeze(["text/plain"]),
    parser: repository(
      "bounded MediaWiki table parser",
      "No maintained browser parser exposes tabular MediaWiki rows; the contract accepts only explicit header and row markers and validates cardinality.",
    ),
  }),
  mysql: Object.freeze({
    mimeTypes: Object.freeze(["application/sql"]),
    parser: repository(
      "bounded INSERT parser",
      "Executing arbitrary SQL in-browser is unsafe; the contract accepts one INSERT column list whose VALUES cells are doubled-quote string literals, NULL, booleans, or signed decimal numbers, and rejects every other statement shape.",
    ),
  }),
  sql: Object.freeze({
    mimeTypes: Object.freeze(["application/sql"]),
    parser: repository(
      "bounded INSERT parser",
      "Executing arbitrary SQL in-browser is unsafe; the contract accepts one INSERT column list whose VALUES cells are doubled-quote string literals, NULL, booleans, or signed decimal numbers, and rejects every other statement shape.",
    ),
  }),
  xml: Object.freeze({
    mimeTypes: Object.freeze(["application/xml", "text/xml"]),
    parser: library("fast-xml-parser 5"),
  }),
  yaml: Object.freeze({
    mimeTypes: Object.freeze(["application/yaml", "text/yaml"]),
    parser: library("yaml 2"),
  }),
});

export const tableOutputContracts = Object.freeze({
  csv: Object.freeze({
    mimeType: "text/csv",
    extension: "csv",
    serializer: library("Papa Parse 5"),
  }),
  excel: Object.freeze({
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
    serializer: library("write-excel-file 4"),
  }),
  html: Object.freeze({
    mimeType: "text/html",
    extension: "html",
    serializer: library("parse5 8"),
  }),
  json: Object.freeze({
    mimeType: "application/json",
    extension: "json",
    serializer: platform("JSON.stringify"),
  }),
  jsonlines: Object.freeze({
    mimeType: "application/x-ndjson",
    extension: "jsonl",
    serializer: platform("JSON.stringify"),
  }),
  latex: Object.freeze({
    mimeType: "text/x-tex",
    extension: "tex",
    serializer: repository(
      "escaped tabular serializer",
      "The output is a bounded tabular document, so direct delimiter escaping is smaller and safer than a general TeX generator; round-trip fixtures prove rows and schema.",
    ),
  }),
  markdown: Object.freeze({
    mimeType: "text/markdown",
    extension: "md",
    serializer: library("markdown-table 3"),
  }),
  mediawiki: Object.freeze({
    mimeType: "text/plain",
    extension: "wiki",
    serializer: repository(
      "escaped MediaWiki table serializer",
      "No maintained browser serializer targets this narrow table syntax; semantic fixtures round-trip explicit table, header, and row markers.",
    ),
  }),
  mysql: Object.freeze({
    mimeType: "application/sql",
    extension: "sql",
    serializer: repository(
      "escaped MySQL INSERT serializer",
      "The output contract is one deterministic INSERT statement, and identifier/literal escaping plus parser round-trip fixtures prove its schema and rows.",
    ),
  }),
  pdf: Object.freeze({
    mimeType: "application/pdf",
    extension: "pdf",
    serializer: library("pdf-lib 1"),
  }),
  sql: Object.freeze({
    mimeType: "application/sql",
    extension: "sql",
    serializer: repository(
      "escaped SQL INSERT serializer",
      "The output contract is one deterministic INSERT statement, and literal escaping plus parser round-trip fixtures prove its schema and rows.",
    ),
  }),
  xml: Object.freeze({
    mimeType: "application/xml",
    extension: "xml",
    serializer: library("fast-xml-parser 5"),
  }),
  yaml: Object.freeze({
    mimeType: "application/yaml",
    extension: "yaml",
    serializer: library("yaml 2"),
  }),
});

export type TableInputFormat = keyof typeof tableInputContracts;
export type TableOutputFormat = keyof typeof tableOutputContracts;

const unsupportedOutputs = Object.freeze([
  "actionscript",
  "ascii",
  "asciidoc",
  "asp",
  "avro",
  "bbcode",
  "dax",
  "firebase",
  "ini",
  "jira",
  "jpeg",
  "magic",
  "matlab",
  "pandasdataframe",
  "php",
  "protobuf",
  "png",
  "qlik",
  "rdataframe",
  "rdf",
  "restructuredtext",
  "ruby",
  "textile",
  "toml",
  "tracwiki",
] as const);

const unsupportedOutputSet = new Set<string>(unsupportedOutputs);

export type TableOperationPolicy =
  | Readonly<{
      kind: "eligible";
      toolId: string;
      from: TableInputFormat;
      to: TableOutputFormat;
    }>
  | Readonly<{
      kind: "unsupported" | "unknown";
      toolId: string;
      reason: string;
      sourceNeeded: string;
    }>;

export function getTableOperationPolicy(toolId: string): TableOperationPolicy {
  const tool = toolCatalog.getById(toolId);
  if (!tool?.isActive || tool.content?.tool.renderer !== "table") {
    return Object.freeze({
      kind: "unknown",
      toolId,
      reason:
        "The Tool id is not an active table operation in the Tool Catalog.",
      sourceNeeded: "Use a canonical active table Tool id.",
    });
  }
  if (!tool.from || !(tool.from in tableInputContracts) || !tool.to) {
    return Object.freeze({
      kind: "unknown",
      toolId,
      reason: "The table operation has no explicit input/output contract.",
      sourceNeeded:
        "Classify both canonical formats before wiring a processor.",
    });
  }
  if (unsupportedOutputSet.has(tool.to)) {
    const label = tool.to.toUpperCase();
    if (tool.to === "png" || tool.to === "jpeg") {
      return Object.freeze({
        kind: "unsupported",
        toolId,
        reason: `${label} table output cannot independently prove that the visible raster preserves every schema and row value.`,
        sourceNeeded: `Adopt an independent visible-content validator before enabling ${label} table output.`,
      });
    }
    return Object.freeze({
      kind: "unsupported",
      toolId,
      reason: `${label} output has no maintained browser serializer and semantic validator in this repository.`,
      sourceNeeded: `Adopt a maintained browser serializer and validate the emitted ${label} document before enabling this Tool.`,
    });
  }
  if (!(tool.to in tableOutputContracts)) {
    return Object.freeze({
      kind: "unknown",
      toolId,
      reason: "The table output has no explicit processor policy.",
      sourceNeeded: "Classify the canonical output before wiring a processor.",
    });
  }
  return Object.freeze({
    kind: "eligible",
    toolId,
    from: tool.from as TableInputFormat,
    to: tool.to as TableOutputFormat,
  });
}

export function getEligibleTableToolIds(): readonly string[] {
  return Object.freeze(
    toolCatalog.activeTools.flatMap((tool) =>
      getTableOperationPolicy(tool.id).kind === "eligible" ? [tool.id] : [],
    ),
  );
}

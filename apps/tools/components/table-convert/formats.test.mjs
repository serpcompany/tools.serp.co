import test from "node:test";
import assert from "node:assert/strict";

import {
  BINARY_OUTPUT_FORMATS,
  OUTPUT_FILE_TYPES,
  OUTPUT_FORMATS,
  isBinaryOutput,
  outputFileName,
  outputMimeType,
} from "./formats.ts";

test("every output format has a file extension and a media type, and nothing else does", () => {
  const formats = OUTPUT_FORMATS.map((option) => option.value).sort();
  assert.deepEqual(Object.keys(OUTPUT_FILE_TYPES).sort(), formats);
  for (const format of formats) {
    const { extension, mimeType } = OUTPUT_FILE_TYPES[format];
    assert.match(extension, /^[A-Za-z0-9]+$/, `${format}: an extension without the dot`);
    assert.match(mimeType, /^[a-z]+\/[a-z0-9.+-]+$/, `${format}: a media type`);
  }
  for (const format of BINARY_OUTPUT_FORMATS) assert.ok(formats.includes(format), format);
});

test("the file types the issue names, and .txt for formats with no extension of their own", () => {
  const extensions = Object.fromEntries(Object.entries(OUTPUT_FILE_TYPES).map(([format, type]) => [format, type.extension]));
  assert.deepEqual(
    {
      json: extensions.json,
      csv: extensions.csv,
      jsonlines: extensions.jsonlines,
      markdown: extensions.markdown,
      html: extensions.html,
      sql: extensions.sql,
      mysql: extensions.mysql,
      xml: extensions.xml,
      yaml: extensions.yaml,
      latex: extensions.latex,
      toml: extensions.toml,
      ini: extensions.ini,
      php: extensions.php,
      ruby: extensions.ruby,
      matlab: extensions.matlab,
      pandasdataframe: extensions.pandasdataframe,
      rdataframe: extensions.rdataframe,
      restructuredtext: extensions.restructuredtext,
      asciidoc: extensions.asciidoc,
      excel: extensions.excel,
      pdf: extensions.pdf,
      png: extensions.png,
      jpeg: extensions.jpeg,
      avro: extensions.avro,
      protobuf: extensions.protobuf,
    },
    {
      json: "json",
      csv: "csv",
      jsonlines: "jsonl",
      markdown: "md",
      html: "html",
      sql: "sql",
      mysql: "sql",
      xml: "xml",
      yaml: "yaml",
      latex: "tex",
      toml: "toml",
      ini: "ini",
      php: "php",
      ruby: "rb",
      matlab: "m",
      pandasdataframe: "py",
      rdataframe: "R",
      restructuredtext: "rst",
      asciidoc: "adoc",
      excel: "xlsx",
      pdf: "pdf",
      png: "png",
      jpeg: "jpeg",
      avro: "avro",
      protobuf: "pb",
    },
  );
  for (const format of ["ascii", "bbcode", "jira", "tracwiki"]) assert.equal(extensions[format], "txt", format);
});

test("a download is named after the uploaded file, or table for pasted text", () => {
  assert.equal(outputFileName("sales.csv", "json"), "sales.json");
  assert.equal(outputFileName("Q3 report.v2.md", "excel"), "Q3 report.v2.xlsx");
  assert.equal(outputFileName("data", "csv"), "data.csv");
  assert.equal(outputFileName(null, "pdf"), "table.pdf");
  assert.equal(outputFileName(".csv", "yaml"), "table.yaml");
  assert.equal(outputFileName("sales.csv", "protobuf"), "sales.pb");
  assert.equal(outputFileName("sales.csv", "protobuf", "proto"), "sales.proto");
});

test("text downloads are UTF-8, binary ones carry their own type", () => {
  assert.equal(outputMimeType("csv"), "text/csv;charset=utf-8");
  assert.equal(outputMimeType("json"), "application/json;charset=utf-8");
  assert.equal(outputMimeType("excel"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(outputMimeType("png"), "image/png");
  assert.deepEqual(
    OUTPUT_FORMATS.map((option) => option.value).filter(isBinaryOutput),
    ["avro", "protobuf", "excel", "pdf", "png", "jpeg"],
  );
});

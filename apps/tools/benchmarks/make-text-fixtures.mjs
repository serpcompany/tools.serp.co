// Writes the text and XML fixtures TXT and XML to PDF (#283) must refuse,
// the same bytes each run: `node benchmarks/make-text-fixtures.mjs` from
// apps/tools. fixture-matrix.json says how each was read back.
//
// - sample-cjk.txt: UTF-8 text with Japanese, Chinese and Korean lines,
//   which the PDF's font (DejaVu Sans) has no glyphs for.
// - sample-malformed.xml: sample.xml with a <row> left open, so its
//   </rows> closes the wrong element.

import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export function sampleCjk() {
  return ["SERP Tools sample text", "Japanese: 東京は晴れです", "Chinese: 你好，世界", "Korean: 안녕하세요", ""].join("\n");
}

export function sampleMalformedXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<rows>",
    "  <row><name>Alpha</name><count>1</count></row>",
    "  <row><name>Beta</name><count>2</count>",
    "</rows>",
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = { "sample-cjk.txt": sampleCjk(), "sample-malformed.xml": sampleMalformedXml() };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(fixtures, name), text);
    console.log(`${name}: ${Buffer.byteLength(text)} bytes`);
  }
}

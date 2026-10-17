// Writes the PDF fixtures of PDF to TXT, HTML and EPUB (#282) with jsPDF,
// the same bytes each run: `node benchmarks/make-pdf-fixtures.mjs` from
// apps/tools. fixture-matrix.json says how each was read back.
//
// - sample-text.pdf: two US Letter pages of text with a heading and three
//   paragraphs, holding the sweep's markers (TEXT_MARKERS in
//   scripts/lib/tool-sweep.mjs), one with markup characters in it.
// - sample-scan.pdf: a page that is only a picture of text
//   (sample-text.png), as a scan is, with no text to extract.
// - sample-protected.pdf: a page of text behind a password ("fixture").
// - sample-truncated.pdf: sample-text.pdf cut off halfway.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { jsPDF } from "jspdf";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
// A PDF date string: jsPDF would write a Date in the machine's time zone.
const CREATED = "D:20261017000000+00'00'";

function letter(options = {}) {
  const doc = new jsPDF({ unit: "pt", format: "letter", ...options });
  doc.setCreationDate(CREATED);
  doc.setFileId("282282282282282282282282282282AA");
  doc.setFont("helvetica", "normal");
  return doc;
}

// Lines of text at 12 pt, from `top`, 16 pt apart.
function lines(doc, top, texts) {
  doc.setFontSize(12);
  texts.forEach((text, index) => doc.text(text, 72, top + index * 16));
}

export function sampleText() {
  const doc = letter();
  doc.setFontSize(18);
  doc.text("Sample text PDF", 72, 72);
  lines(doc, 110, ["Alpha is the first word of this paragraph, which runs", "over two lines on the first page."]);
  lines(doc, 160, ["Salt & pepper <b>not bold</b> stays as text, not markup."]);
  doc.addPage();
  lines(doc, 72, ["Bravo opens the second page.", "It is the last paragraph of the file."]);
  return new Uint8Array(doc.output("arraybuffer"));
}

export function sampleScan() {
  const doc = letter();
  const png = new Uint8Array(readFileSync(path.join(fixtures, "sample-text.png")));
  doc.addImage(png, "PNG", 72, 72, 468, 156);
  return new Uint8Array(doc.output("arraybuffer"));
}

export function sampleProtected() {
  const doc = letter({
    encryption: { userPassword: "fixture", ownerPassword: "fixture-owner", userPermissions: ["print", "copy"] },
  });
  lines(doc, 72, ["This page can only be read with the password."]);
  return new Uint8Array(doc.output("arraybuffer"));
}

export function sampleTruncated(text = sampleText()) {
  return text.slice(0, Math.floor(text.length / 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = sampleText();
  const files = {
    "sample-text.pdf": text,
    "sample-scan.pdf": sampleScan(),
    "sample-protected.pdf": sampleProtected(),
    "sample-truncated.pdf": sampleTruncated(text),
  };
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(path.join(fixtures, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
}

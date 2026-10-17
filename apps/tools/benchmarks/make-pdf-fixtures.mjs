// Writes the PDF fixtures of PDF to TXT, HTML and EPUB (#282) and of PDF and
// AI to an image (#284) with jsPDF, the same bytes each run:
// `node benchmarks/make-pdf-fixtures.mjs` from apps/tools.
// fixture-matrix.json says how each was read back.
//
// - sample-text.pdf: two US Letter pages of text with a heading and three
//   paragraphs, holding the sweep's markers (TEXT_MARKERS in
//   scripts/lib/tool-sweep.mjs), one with markup characters in it.
// - sample-scan.pdf: a page that is only a picture of text
//   (sample-text.png), as a scan is, with no text to extract.
// - sample-protected.pdf: a page of text behind a password ("fixture").
// - sample-truncated.pdf: sample-text.pdf cut off halfway.
// - sample-colours.pdf: two pages of different sizes, 300 x 200 pt and
//   200 x 300 pt, each of coloured shapes and a line of black text, and on
//   each a shape at half opacity over the bare page, where nothing else is
//   drawn. Its images have many colours, so the sweep decodes them and
//   fails a blank one, and must save one a page (PAGE_COUNTS).
// - sample-colours.ai: one 360 x 240 pt artboard of coloured shapes, as a
//   PDF, which an AI file saved with Create PDF Compatible File is.

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

// A page `width` x `height` pt, landscape or portrait as its sides are.
const orientation = (width, height) => (width > height ? "landscape" : "portrait");

function drawn(width, height, fileId) {
  const doc = new jsPDF({ unit: "pt", format: [width, height], orientation: orientation(width, height) });
  doc.setCreationDate(CREATED);
  doc.setFileId(fileId);
  doc.setFont("helvetica", "normal");
  return doc;
}

// A shape at half opacity, where only the bare page is under it.
function halfOpacity(doc, draw) {
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.5, "stroke-opacity": 0.5 }));
  draw();
  doc.restoreGraphicsState();
}

export function sampleColours() {
  const doc = drawn(300, 200, "284284284284284284284284284284AA");
  doc.setFillColor(220, 40, 40);
  doc.rect(20, 20, 120, 70, "F");
  doc.setFillColor(40, 160, 70);
  doc.circle(210, 60, 40, "F");
  doc.setFillColor(40, 80, 210);
  doc.rect(20, 110, 80, 60, "F");
  halfOpacity(doc, () => {
    doc.setFillColor(0, 0, 0);
    doc.rect(170, 120, 110, 60, "F");
  });
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14);
  doc.text("Page 1", 110, 145);
  doc.addPage([200, 300], orientation(200, 300));
  doc.setFillColor(240, 150, 20);
  doc.rect(20, 20, 160, 80, "F");
  doc.setFillColor(130, 50, 170);
  doc.triangle(30, 260, 100, 130, 170, 260, "F");
  halfOpacity(doc, () => {
    doc.setFillColor(20, 170, 190);
    doc.circle(150, 130, 30, "F");
  });
  doc.setFontSize(14);
  doc.text("Page 2", 70, 285);
  return new Uint8Array(doc.output("arraybuffer"));
}

export function sampleArtboard() {
  const doc = drawn(360, 240, "284284284284284284284284284284AB");
  doc.setFillColor(250, 200, 30);
  doc.rect(0, 0, 360, 80, "F");
  doc.setFillColor(30, 120, 200);
  doc.circle(90, 150, 55, "F");
  doc.setFillColor(200, 30, 120);
  doc.triangle(180, 210, 250, 95, 320, 210, "F");
  halfOpacity(doc, () => {
    doc.setFillColor(20, 20, 20);
    doc.rect(150, 100, 25, 120, "F");
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = sampleText();
  const files = {
    "sample-text.pdf": text,
    "sample-scan.pdf": sampleScan(),
    "sample-protected.pdf": sampleProtected(),
    "sample-truncated.pdf": sampleTruncated(text),
    "sample-colours.pdf": sampleColours(),
    "sample-colours.ai": sampleArtboard(),
  };
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(path.join(fixtures, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
}

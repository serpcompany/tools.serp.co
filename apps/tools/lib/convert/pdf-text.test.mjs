import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { strFromU8, unzipSync } from "fflate";
import { jsPDF } from "jspdf";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import sax from "sax";

import { sampleProtected, sampleScan, sampleText, sampleTruncated } from "../../benchmarks/make-pdf-fixtures.mjs";
import { checkOutputFormat } from "./output-format.ts";
import {
  cleanText,
  convertPdfText,
  NO_TEXT_MESSAGE,
  paragraphs,
  PDF_TEXT_LIMITS,
  readPdfText,
} from "./pdf-text.ts";
import { isPdfTextConversion } from "./pdf-text-targets.ts";
import { pdfTextFailure } from "./workerClient.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const read = (name) => toBuffer(readFileSync(path.join(fixtures, name)));
const toBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const decode = (buffer) => new TextDecoder().decode(buffer);
// Node's pdfjs-dist; pdf-text.vendored.test.mjs runs this file again on the
// copy in public/vendor/pdfjs, the one the browser loads.
const convert = (buf, to, fileName = "sample-text.pdf", options = {}) =>
  convertPdfText(buf, to, fileName, { pdfjs, ...options });

// What XML 1.0 forbids in a document: no file the converter writes may hold one.
// eslint-disable-next-line no-control-regex -- the control characters are what it finds
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// Parses XML strictly, as an e-reader does, and returns its text (the
// elements' text, entities decoded) and the elements it opened. Throws on
// anything that isn't well-formed.
function parseXml(xml, { strict = true } = {}) {
  assert.doesNotMatch(xml, XML_FORBIDDEN, "a character XML forbids");
  const parser = sax.parser(strict, { xmlns: strict, lowercase: !strict });
  const elements = [];
  let text = "";
  let skip = 0;
  parser.onerror = (error) => {
    throw error;
  };
  parser.onopentag = (node) => {
    const name = node.local ?? node.name;
    elements.push(name);
    if (["head", "script", "style"].includes(name)) skip += 1;
  };
  parser.onclosetag = (name) => {
    if (["head", "script", "style"].includes(name.replace(/^.*:/, "").toLowerCase())) skip -= 1;
  };
  parser.ontext = (value) => {
    if (!skip) text += value;
  };
  parser.write(xml).close();
  return { text, elements };
}

// Opens an EPUB as a reader does: the mimetype entry first and stored, the
// container naming the package, the package's manifest files all there, and
// every document in the spine well-formed XHTML. Returns the spine's file
// names and each document's text.
function openEpub(buffer) {
  const bytes = new Uint8Array(buffer);
  assert.equal(checkOutputFormat(buffer, "epub").ok, true);
  assert.equal(bytes[8] | (bytes[9] << 8), 0, "mimetype is stored, not compressed");
  const files = unzipSync(bytes);
  assert.equal(Object.keys(files)[0], "mimetype");
  assert.equal(strFromU8(files.mimetype), "application/epub+zip");
  const container = strFromU8(files["META-INF/container.xml"]);
  parseXml(container);
  const opfPath = /full-path="([^"]+)"/.exec(container)[1];
  const opf = strFromU8(files[opfPath]);
  parseXml(opf);
  const base = opfPath.replace(/[^/]+$/, "");
  const manifest = new Map(
    [...opf.matchAll(/<item id="([^"]+)" href="([^"]+)" media-type="([^"]+)"/g)].map(([, id, href, type]) => [id, { href, type }]),
  );
  for (const { href } of manifest.values()) assert.ok(files[base + href], `${href} is in the package`);
  assert.match(opf, /properties="nav"/);
  assert.match(opf, /<dc:language>[^<]+<\/dc:language>/);
  const spine = [...opf.matchAll(/<itemref idref="([^"]+)"\/>/g)].map(([, id]) => manifest.get(id).href);
  const nav = parseXml(strFromU8(files[`${base}nav.xhtml`]));
  const texts = spine.map((href) => parseXml(strFromU8(files[base + href])).text.trim());
  return { spine, texts, nav: nav.text, opf };
}

// A PDF written by hand, so a test controls every byte of its text: pages of
// content streams drawn in Helvetica, whose codes a ToUnicode CMap can map
// to any characters, and the glyph names of an encoding's `differences` to
// the characters those names give (uniD800 is a lone surrogate) for codes it
// leaves out. pdf.js 5.4 (the browser's) reads this font's codes below 0x20
// as spaces, whatever they map to, so a test's characters are drawn from 0x20
// up.
function handPdf({ pages, toUnicode = null, differences = null, lang = null }) {
  const objects = [];
  const add = (body) => objects.push(body);
  const stream = (data) => `<< /Length ${data.length} >>\nstream\n${data}\nendstream`;
  add("");
  add("");
  let cmap = null;
  if (toUnicode) {
    const entries = Object.entries(toUnicode).map(([code, hex]) => `<${code}> <${hex}>`);
    add(
      stream(
        `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Test def /CMapType 2 def\n` +
          `1 begincodespacerange <00> <FF> endcodespacerange\n${entries.length} beginbfchar\n${entries.join("\n")}\nendbfchar\n` +
          "endcmap CMapName currentdict /CMap defineresource pop end end",
      ),
    );
    cmap = objects.length;
  }
  const encoding = differences ? ` /Encoding << /Type /Encoding /Differences [${differences}] >>` : "";
  add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica${encoding}${cmap ? ` /ToUnicode ${cmap} 0 R` : ""} >>`);
  const font = objects.length;
  const kids = pages.map((content) => {
    add(stream(content));
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${objects.length} 0 R >>`,
    );
    return objects.length;
  });
  objects[0] = `<< /Type /Catalog /Pages 2 0 R${lang ? ` /Lang (${lang})` : ""} >>`;
  objects[1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.7\n";
  const offsets = objects.map((body, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return toBuffer(Uint8Array.from(out, (char) => char.charCodeAt(0)));
}

// A content stream drawing each line at 12 pt, 14 pt apart from the top.
const textLines = (lines, { x = 72, top = 720, size = 12, leading = 14 } = {}) =>
  lines
    .map((line, index) => `BT /F1 ${size} Tf ${x} ${top - index * leading} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`)
    .join("\n");

// The text of each run on a PDF's pages as pdf.js itself gives it, before
// readPdfText counts and cleans it.
async function pdfjsRuns(buffer) {
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 });
  const doc = await task.promise;
  const runs = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    for (const item of (await (await doc.getPage(number)).getTextContent()).items) runs.push(item.str);
  }
  await task.destroy();
  return runs;
}

test("the PDF fixtures are the ones make-pdf-fixtures.mjs writes", () => {
  const made = { "sample-text.pdf": sampleText(), "sample-scan.pdf": sampleScan(), "sample-protected.pdf": sampleProtected() };
  made["sample-truncated.pdf"] = sampleTruncated(made["sample-text.pdf"]);
  for (const [name, bytes] of Object.entries(made)) {
    assert.deepEqual(new Uint8Array(read(name)), bytes, `${name}: run node benchmarks/make-pdf-fixtures.mjs`);
  }
});

test("only PDF to TXT, HTML and EPUB read the PDF's text", () => {
  for (const to of ["txt", "TXT", "html", "epub"]) assert.equal(isPdfTextConversion("pdf", to), true, to);
  for (const [from, to] of [["pdf", "png"], ["pdf", "jpg"], ["ai", "txt"], ["png", "txt"], ["svg", "html"], ["png", "epub"]]) {
    assert.equal(isPdfTextConversion(from, to), false, `${from} to ${to}`);
  }
});

test("a two-page PDF's text comes out in order, in paragraphs, in TXT", async () => {
  const { buffer, notice } = await convert(read("sample-text.pdf"), "txt");
  assert.equal(
    decode(buffer),
    [
      "Sample text PDF",
      "",
      "Alpha is the first word of this paragraph, which runs",
      "over two lines on the first page.",
      "",
      "Salt & pepper <b>not bold</b> stays as text, not markup.",
      "",
      "Bravo opens the second page.",
      "It is the last paragraph of the file.",
      "",
    ].join("\n"),
  );
  assert.equal(notice, undefined);
});

test("in HTML, each page is a section of paragraphs, and its text is only text", async () => {
  const { buffer } = await convert(read("sample-text.pdf"), "html");
  const html = decode(buffer);
  assert.match(html, /^<!DOCTYPE html>\n<html lang="en">/);
  assert.match(html, /<title>sample-text<\/title>/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/);
  const sections = [...html.matchAll(/<section id="page-(\d)" aria-label="Page \d">\n([\s\S]*?)<\/section>/g)];
  assert.deepEqual(sections.map(([, page]) => page), ["1", "2"]);
  assert.deepEqual(
    sections.map(([, , body]) => [...body.matchAll(/<p>(.*?)<\/p>/g)].map(([, text]) => text)),
    [
      [
        "Sample text PDF",
        "Alpha is the first word of this paragraph, which runs over two lines on the first page.",
        "Salt &amp; pepper &lt;b&gt;not bold&lt;/b&gt; stays as text, not markup.",
      ],
      ["Bravo opens the second page. It is the last paragraph of the file."],
    ],
  );
  const { text, elements } = parseXml(html, { strict: false });
  assert.ok(!elements.includes("b"), "the PDF's <b> is text, not an element");
  assert.ok(text.indexOf("Alpha") < text.indexOf("Salt & pepper <b>not bold</b>"));
  assert.ok(text.indexOf("Salt & pepper") < text.indexOf("Bravo"));
});

test("in EPUB, each page is an XHTML document in the spine, in order", async () => {
  const { buffer } = await convert(read("sample-text.pdf"), "epub");
  const epub = openEpub(buffer);
  assert.deepEqual(epub.spine, ["page-1.xhtml", "page-2.xhtml"]);
  assert.match(epub.texts[0], /Alpha is the first word of this paragraph, which runs over two lines/);
  assert.match(epub.texts[0], /Salt & pepper <b>not bold<\/b> stays as text/);
  assert.doesNotMatch(epub.texts[0], /Bravo/);
  assert.match(epub.texts[1], /Bravo opens the second page\. It is the last paragraph/);
  assert.match(epub.nav, /Page 1\s*Page 2/);
  assert.match(epub.opf, /<dc:title>sample-text<\/dc:title>/);
});

test("a PDF of pictures, as a scan is, or of blank pages has no text, and nothing is saved", async () => {
  for (const name of ["sample-scan.pdf", "sample.pdf"]) {
    for (const to of ["txt", "html", "epub"]) {
      await assert.rejects(convert(read(name), to), { name: "PdfTextError", code: "no_text", message: NO_TEXT_MESSAGE });
    }
  }
  // Spaces alone aren't text either, and blank pages have none.
  await assert.rejects(convert(handPdf({ pages: [textLines(["   "])] }), "txt"), { code: "no_text" });
  await assert.rejects(convert(handPdf({ pages: ["", ""] }), "txt"), { code: "no_text", message: NO_TEXT_MESSAGE });
});

test("a password-protected PDF is refused as one, keeping pdf.js's error", async () => {
  await assert.rejects(convert(read("sample-protected.pdf"), "txt"), (error) => {
    assert.equal(error.code, "password_protected");
    assert.match(error.message, /password-protected/);
    assert.equal(error.cause.name, "PasswordException");
    return true;
  });
});

test("only a file pdf.js rejects as invalid is reported as damaged", async () => {
  const png = readFileSync(path.join(fixtures, "sample.png"));
  const cases = {
    "cut off halfway": read("sample-truncated.pdf"),
    "a PNG named .pdf": toBuffer(png),
    "text named .pdf": toBuffer(new TextEncoder().encode("Just some text, not a PDF.")),
    "an empty file": new ArrayBuffer(0),
    "a PDF header alone": toBuffer(new TextEncoder().encode("%PDF-1.7\n")),
  };
  for (const [label, buf] of Object.entries(cases)) {
    await assert.rejects(convert(buf, "epub"), (error) => {
      assert.equal(error.code, "unreadable_pdf", label);
      assert.match(error.message, /damaged or incomplete, or not a PDF/);
      assert.equal(error.cause.name, "InvalidPDFException", label);
      return true;
    });
  }
});

test("the page and telemetry get the refusal's message and code, or a plain try-again with pdf.js's error name", () => {
  const refusal = Object.assign(new Error("This PDF has no text to extract."), { name: "PdfTextError", code: "no_text" });
  const refused = pdfTextFailure(refusal, "epub");
  assert.equal(refused.telemetryCode, "no_text");
  assert.equal(refused.message, "This PDF has no text to extract.");
  assert.deepEqual(refused.telemetryMetadata, { from: "pdf", to: "epub", engine: "pdfjs-text" });
  assert.equal(refused.cause, refusal);

  const workerFailed = Object.assign(new Error("Worker was terminated"), { name: "UnknownErrorException" });
  const failed = pdfTextFailure(workerFailed, "txt");
  assert.equal(failed.telemetryCode, "UnknownErrorException");
  assert.equal(failed.message, "This PDF couldn't be converted to TXT. Try again, or reload the page.");
  assert.equal(failed.cause, workerFailed);

  assert.equal(pdfTextFailure(new Error("plain"), "html").telemetryCode, "convert_failed");
  assert.equal(pdfTextFailure(new RangeError("Array buffer allocation failed"), "html").telemetryCode, "RangeError");
  assert.equal(pdfTextFailure("not an error", "html").telemetryCode, "convert_failed");
  // A code that isn't a refusal, or a name that isn't a safe code, isn't kept.
  assert.equal(pdfTextFailure(Object.assign(new Error("x"), { code: "ENOENT" }), "txt").telemetryCode, "convert_failed");
  assert.equal(pdfTextFailure(Object.assign(new Error("x"), { name: "Bad name!" }), "txt").telemetryCode, "convert_failed");
});

test("text that looks like markup or holds characters XML forbids stays text, and every file parses", async () => {
  // Between A's (41): codes 42-48 mapped to NUL, BEL, U+FFFE, U+FFFF, a C1
  // control, DEL and an emoji, and 49 and 4A named as a lone high and a lone
  // low surrogate.
  const pdf = handPdf({
    pages: [
      [
        "BT /F1 12 Tf 72 720 Td (<script>alert\\(1\\)</script> & ]]> <!-- x --> &amp; done) Tj ET",
        "BT /F1 12 Tf 72 700 Td <41424143414441454146414741484149414A41> Tj ET",
      ].join("\n"),
    ],
    toUnicode: { "41": "0041", "42": "0000", "43": "0007", "44": "FFFE", "45": "FFFF", "46": "0085", "47": "007F", "48": "D83DDE00" },
    differences: "73 /uniD800 /uniDC00",
  });
  // pdf.js gives every one of them, so what keeps them out of the files is
  // cleanText.
  assert.ok(
    (await pdfjsRuns(pdf.slice(0))).join("").includes("A\u0000A\u0007A￾A￿A\u0085A\u007FA\u{1F600}A\uD800A\uDC00A"),
    "pdf.js gives the characters as drawn",
  );
  const txt = decode((await convert(pdf.slice(0), "txt", "<evil> & co.pdf")).buffer);
  assert.equal(txt, "<script>alert(1)</script> & ]]> <!-- x --> &amp; done\n\nAAAAAAA\u{1F600}AAA\n");

  const html = decode((await convert(pdf.slice(0), "html", "<evil> & co.pdf")).buffer);
  assert.doesNotMatch(html, XML_FORBIDDEN);
  assert.match(html, /<title>&lt;evil&gt; &amp; co<\/title>/);
  const page = parseXml(html, { strict: false });
  assert.ok(!page.elements.includes("script"), "no script element");
  assert.match(page.text, /<script>alert\(1\)<\/script> & \]\]> <!-- x --> &amp; done/);
  assert.match(page.text, /AAAAAAA\u{1F600}AAA/u);

  const epub = openEpub((await convert(pdf.slice(0), "epub", "<evil> & co.pdf")).buffer);
  assert.equal(epub.texts.length, 1);
  assert.match(epub.texts[0], /<script>alert\(1\)<\/script> & \]\]> <!-- x --> &amp; done/);
  assert.match(epub.texts[0], /AAAAAAA\u{1F600}AAA/u);
  assert.match(epub.opf, /<dc:title>&lt;evil&gt; &amp; co<\/dc:title>/);
});

test("cleanText drops what isn't text and keeps every character that is", () => {
  assert.equal(cleanText("a\u0000b\u0008c\u000Bd\u001Fe\u007Ff\u0085g\u009Fh￾i￿j"), "abcdefghij");
  assert.equal(cleanText("lone \uD800 high, lone \uDC00 low, \uDC00\uD800 reversed"), "lone  high, lone  low,  reversed");
  assert.equal(cleanText("tab\tnew\nline\rend"), "tab new line end");
  const kept = "Ünïcödé — “quotes” 中文 العربية עברית \u{1F600}  nbsp ­soft";
  assert.equal(cleanText(kept), kept);
});

test("a PDF's language becomes the HTML and EPUB language, if it is a language tag", async () => {
  const german = handPdf({ pages: [textLines(["Guten Tag"])], lang: "de-DE" });
  assert.match(decode((await convert(german.slice(0), "html")).buffer), /<html lang="de-DE">/);
  assert.match(openEpub((await convert(german.slice(0), "epub")).buffer).opf, /<dc:language>de-DE<\/dc:language>/);
  const bogus = handPdf({ pages: [textLines(["Hello"])], lang: '"><x' });
  assert.match(decode((await convert(bogus, "html")).buffer), /<html lang="en">/);
});

test("a page with no text is named, and is empty where the others aren't", async () => {
  const pdf = handPdf({ pages: [textLines(["First page"]), "", textLines(["Third page"])] });
  const { buffer, notice } = await convert(pdf.slice(0), "html");
  assert.equal(notice, "Page 2 has no text to extract (it may be a scan or a blank page), so this file has no text from it.");
  assert.match(decode(buffer), /<section id="page-2" aria-label="Page 2">\n<\/section>/);
  assert.equal(decode((await convert(pdf.slice(0), "txt")).buffer), "First page\n\nThird page\n");
  assert.equal(openEpub((await convert(pdf.slice(0), "epub")).buffer).spine.length, 3);

  const many = handPdf({ pages: ["", textLines(["Text"]), "", "", "", "", ""] });
  assert.match((await convert(many, "txt")).notice, /^6 of 7 pages have no text to extract \(they may be scans or blank pages\), so this file has no text from them\.$/);
  const two = handPdf({ pages: [textLines(["Text"]), "", textLines(["Text"]), ""] });
  assert.match((await convert(two, "txt")).notice, /^Pages 2 and 4 have no text/);
});

test("a two-column page, its columns stored one after the other, keeps each column whole", async () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFontSize(11);
  const left = ["Left column, first line", "left column, second line", "left column, last line"];
  const right = ["Right column, first line", "right column, second line"];
  left.forEach((line, index) => doc.text(line, 72, 100 + index * 14));
  right.forEach((line, index) => doc.text(line, 320, 100 + index * 14));
  const txt = decode((await convert(doc.output("arraybuffer"), "txt")).buffer);
  assert.equal(txt, `${left.join("\n")}\n\n${right.join("\n")}\n`);
});

test("lines become paragraphs by the gaps between them, whatever the line spacing", () => {
  // Lines at `offsets` (points up the page), each `size` points.
  const lines = (offsets, size = 12, texts = offsets.map((_, index) => `line ${index + 1}`)) =>
    offsets.map((offset, index) => ({ text: texts[index], offset, size: Array.isArray(size) ? size[index] : size }));
  const grouped = (result) => result.map((paragraph) => paragraph.length);

  // Word's default: 1.32 font sizes between lines, 2.05 between paragraphs.
  const word = [700, 684.2, 668.4, 643.8, 628, 603.4];
  assert.deepEqual(grouped(paragraphs(lines(word))), [3, 2, 1]);
  // 1.5 line spacing: 1.83 between lines, 2.55 between paragraphs.
  const wide = [700, 678, 656, 625.4, 603.4, 581.4];
  assert.deepEqual(grouped(paragraphs(lines(wide))), [3, 3]);
  // Double spacing with no extra gap: one paragraph, not a paragraph a line.
  assert.deepEqual(grouped(paragraphs(lines([700, 672, 644, 616, 588]))), [5]);
  // A heading in a larger size starts its own paragraph.
  assert.deepEqual(grouped(paragraphs(lines([700, 680, 666, 652], [18, 12, 12, 12]))), [1, 3]);
  // An empty line, or a line higher up the page (the next column), starts one.
  assert.deepEqual(grouped(paragraphs(lines([700, 686, 672, 700, 686], 12, ["a", "b", "", "c", "d"]))), [2, 2]);
  assert.deepEqual(grouped(paragraphs(lines([700, 686, 672, 700, 686]))), [3, 2]);
  // Runs on one row (table cells pdf.js ends separately) stay together.
  assert.deepEqual(grouped(paragraphs(lines([700, 700, 686]))), [3]);
  // Lines with no position (and so no size) join the paragraph they're in.
  assert.deepEqual(grouped(paragraphs([{ text: "a", offset: null, size: 0 }, ...lines([700, 686])])), [3]);
});

test("a PDF of hundreds of pages converts, every page in order", async () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  for (let page = 1; page <= 600; page += 1) {
    if (page > 1) doc.addPage();
    for (let line = 0; line < 20; line += 1) doc.text(`Page ${page}, line ${line + 1}: the quick brown fox jumps over the lazy dog.`, 72, 72 + line * 16);
  }
  const started = Date.now();
  const epub = openEpub((await convert(doc.output("arraybuffer"), "epub", "book.pdf")).buffer);
  assert.equal(epub.spine.length, 600);
  epub.texts.forEach((text, index) => assert.match(text, new RegExp(`^Page ${index + 1}, line 1: .* Page ${index + 1}, line 20:`)));
  assert.ok(Date.now() - started < 60_000, `took ${Date.now() - started} ms`);
});

test("past its page or character limit a PDF is refused, counted exactly, never a smaller one", async () => {
  const pages = handPdf({ pages: [textLines(["one"]), textLines(["two"]), textLines(["three"])] });
  assert.equal(decode((await convert(pages.slice(0), "txt", "x.pdf", { limits: { pages: 3 } })).buffer), "one\n\ntwo\n\nthree\n");
  await assert.rejects(convert(pages.slice(0), "txt", "x.pdf", { limits: { pages: 2 } }), {
    code: "too_large",
    message: "This PDF has 3 pages; up to 2 can be converted here.",
  });

  // 250 lines of 40 characters on five pages, in several of pdf.js's chunks:
  // the limit is the characters pdf.js gives, spaces it adds included.
  const runs = Array.from({ length: 250 }, (_, index) => `${String(index).padStart(3, "0")} ${"x".repeat(36)}`);
  const page = handPdf({
    pages: [0, 1, 2, 3, 4].map((index) => textLines(runs.slice(index * 50, index * 50 + 50), { top: 760 })),
  });
  const characters = (await pdfjsRuns(page.slice(0))).join("").length;
  assert.ok(characters >= 10_000, `${characters} characters`);
  const text = await readPdfText(page.slice(0), { pdfjs, limits: { characters } });
  assert.deepEqual(text.pages.flat(2), runs);
  await assert.rejects(readPdfText(page.slice(0), { pdfjs, limits: { characters: characters - 1 } }), {
    code: "too_large",
    message: `This PDF has more text than can be converted here (over ${(characters - 1).toLocaleString("en-US")} characters).`,
  });
  assert.deepEqual(PDF_TEXT_LIMITS, { pages: 2_000, characters: 20_000_000, milliseconds: 120_000 });
});

// A pdf.js whose worker never answers: not even with the document, or after
// `pages` pages; and what was stopped.
function hangingPdfjs({ pages = null } = {}) {
  const stopped = { worker: 0, task: 0 };
  const never = new Promise(() => {});
  const doc = {
    numPages: 3,
    getPage: (number) =>
      number > (pages ?? 0)
        ? never
        : Promise.resolve({
            streamTextContent: () =>
              new ReadableStream({
                start(controller) {
                  controller.enqueue({ items: [{ str: `page ${number}`, hasEOL: true, transform: [12, 0, 0, 12, 72, 700] }] });
                  controller.close();
                },
              }),
          }),
  };
  return {
    stopped,
    pdfjs: {
      PDFWorker: class {
        destroy() {
          stopped.worker += 1;
        }
      },
      getDocument: () => ({
        promise: pages === null ? never : Promise.resolve(doc),
        destroy: () => {
          stopped.task += 1;
          return never;
        },
      }),
    },
  };
}

test("a PDF that takes too long to read is refused, and its pdf.js worker stopped, even when it hangs", async () => {
  for (const pages of [null, 1]) {
    const { pdfjs: hanging, stopped } = hangingPdfjs({ pages });
    const started = Date.now();
    await assert.rejects(readPdfText(new ArrayBuffer(8), { pdfjs: hanging, limits: { milliseconds: 100 } }), {
      code: "read_timeout",
      message: /took too long to read/,
    });
    assert.ok(Date.now() - started < 3_000);
    assert.deepEqual(stopped, { worker: 1, task: 1 });
  }
  assert.match(
    (await readPdfText(new ArrayBuffer(8), { pdfjs: hangingPdfjs({ pages: 3 }).pdfjs })).pages.flat(2).join(","),
    /^page 1,page 2,page 3$/,
  );
});

test("two PDFs converted at once each give their own text and title", async () => {
  const first = handPdf({ pages: [textLines(["The first file"])] });
  const second = handPdf({ pages: [textLines(["The second file"]), textLines(["and its second page"])] });
  const [a, b] = await Promise.all([convert(first, "epub", "first.pdf"), convert(second, "epub", "second.pdf")]);
  const [one, two] = [openEpub(a.buffer), openEpub(b.buffer)];
  assert.deepEqual(one.texts, ["The first file"]);
  assert.match(one.opf, /<dc:title>first<\/dc:title>/);
  assert.deepEqual(two.texts, ["The second file", "and its second page"]);
  assert.match(two.opf, /<dc:title>second<\/dc:title>/);
});

test("pdf.js's worker is stopped even when opening the file throws at once", async () => {
  let stopped = 0;
  const broken = {
    PDFWorker: class {
      destroy() {
        stopped += 1;
      }
    },
    getDocument: () => {
      throw new TypeError("Cannot perform Construct on a detached ArrayBuffer");
    },
  };
  await assert.rejects(readPdfText(new ArrayBuffer(8), { pdfjs: broken }), TypeError);
  assert.equal(stopped, 1);
});

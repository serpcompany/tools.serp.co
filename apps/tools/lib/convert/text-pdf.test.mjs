import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { sampleCjk, sampleMalformedXml } from "../../benchmarks/make-text-fixtures.mjs";
import { checkOutputFormat } from "./output-format.ts";
import { PDF_FONT_URL, shapeArabic } from "./pdf-font.ts";
import {
  COLUMNS,
  LINES_PER_PAGE,
  MARGIN,
  PAGE,
  convertTextToPdf,
  printable,
  wrapText,
} from "./text-pdf.ts";
import {
  isTextPdfConversion,
  TEXT_PDF_ENGINES,
  TEXT_PDF_LIMITS,
  TextPdfError,
  tooLargeFileMessage,
} from "./text-pdf-targets.ts";
import { INDENT, MAX_INDENT_LEVELS, decodeXml, listXml } from "./xml-listing.ts";
import { checkInputFile, convertWithWorker, textPdfFailure } from "./workerClient.ts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = path.join(appRoot, "benchmarks/fixtures");
const fontBytes = readFileSync(path.join(appRoot, "public", PDF_FONT_URL));
let fontLoads = 0;
const loadFont = async () => {
  fontLoads += 1;
  return fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength);
};

const encode = (text) => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const fixture = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const convert = (text, from = "txt", options = {}) =>
  convertTextToPdf(typeof text === "string" ? encode(text) : text, from, `file.${from}`, { loadFont, ...options });

// Each page's lines as pdf.js reads them back: the text (pdf.js reads a run
// of spaces inside a line as one), where it starts and ends (points from the
// left edge), its baseline (points from the top) and its font's family:
// monospace for the built-in Courier, sans-serif for DejaVu Sans.
async function pdfPages(buffer) {
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)), verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const lines = [];
    let current = null;
    const content = await page.getTextContent();
    for (const item of content.items) {
      const [, , , , x, y] = item.transform;
      const top = Math.round(PAGE.height - y);
      if (!current || current.top !== top) {
        current = { text: "", x: Math.round(x), top, end: 0, font: content.styles[item.fontName]?.fontFamily };
        lines.push(current);
      }
      current.text += item.str;
      current.end = Math.round(x + item.width);
    }
    pages.push(lines);
  }
  await task.destroy();
  return pages;
}
const texts = (pages) => pages.flat().map((line) => line.text);

test("TXT and XML to PDF are routed by format, each with its own engine label", () => {
  assert.equal(isTextPdfConversion("txt", "pdf"), true);
  assert.equal(isTextPdfConversion("XML", "PDF"), true);
  assert.equal(isTextPdfConversion("txt", "png"), false);
  assert.equal(isTextPdfConversion("csv", "pdf"), false);
  assert.equal(isTextPdfConversion("constructor", "pdf"), false);
  assert.deepEqual(TEXT_PDF_ENGINES, { txt: "text-pdf", xml: "xml-pdf" });
});

test("a Latin text file is set in Courier, with no font downloaded, and reads back line for line", async () => {
  fontLoads = 0;
  const output = await convertTextToPdf(fixture("sample.txt"), "txt", "sample.txt", { loadFont });
  assert.equal(fontLoads, 0, "a Windows-1252 text downloads no font");
  assert.deepEqual(checkOutputFormat(output.buffer, "pdf"), { ok: true });
  assert.equal(output.pages, 1);
  const source = new TextDecoder("latin1").decode(output.buffer);
  assert.doesNotMatch(source, /FontFile2/);
  assert.match(source, /\/Title \(sample\)/);
  const [page] = await pdfPages(output.buffer);
  assert.deepEqual(new Set(page.map((line) => line.font)), new Set(["monospace"]));
  assert.deepEqual(
    page.map((line) => line.text),
    ["SERP Tools sample text", "Alpha, Beta and Gamma are on separate lines:", "Alpha", "Beta", "Gamma"],
  );
  // The blank line after the heading is kept: the next line is two below.
  assert.equal(page[1].top - page[0].top, 24);
  assert.equal(page[2].top - page[1].top, 12);
  assert.equal(page[0].x, MARGIN);
});

test("tabs, CR LF line breaks, a byte order mark and indentation come out as typed", async () => {
  const bom = String.fromCharCode(0xfeff);
  const output = await convert(`${bom}first\r\n\tindented\ttab\r\n\r\n    four spaces\rlast\r\n`);
  const [page] = await pdfPages(output.buffer);
  assert.deepEqual(
    page.map(({ text, x }) => [text, x]),
    [
      ["first", MARGIN],
      ["indented tab", MARGIN + 24],
      ["four spaces", MARGIN + 24],
      ["last", MARGIN],
    ],
  );
  // A tab is spaces to the next fourth column (text-file.ts): "indented",
  // four spaces and "tab" end 19 columns in.
  assert.equal(page[1].end, MARGIN + 19 * 6);
  assert.equal(page[2].top - page[1].top, 24, "the blank line stays");
});

test("a long line wraps at 81 columns, between words, its continuation as indented as it is", async () => {
  assert.equal(COLUMNS, 81);
  assert.equal(LINES_PER_PAGE, 61);
  const words = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
  const [page] = await pdfPages((await convert(`  ${words}`)).buffer);
  assert.ok(page.length > 1);
  for (const line of page) {
    assert.equal(line.x, MARGIN + 12, line.text);
    assert.ok(line.text.length <= COLUMNS - 2, line.text);
    assert.match(line.text, /^word\d+( word\d+)*$/);
  }
  assert.equal(page.map((line) => line.text).join(" "), words);
});

test("a long file wraps onto several pages, each line once, in order", async () => {
  const lines = Array.from({ length: 200 }, (_, index) => `Line ${index + 1}`);
  const output = await convert(lines.join("\n"));
  assert.equal(output.pages, Math.ceil(200 / LINES_PER_PAGE));
  const pages = await pdfPages(output.buffer);
  assert.equal(pages.length, 4);
  assert.deepEqual(pages.map((page) => page.length), [61, 61, 61, 17]);
  assert.deepEqual(texts(pages), lines);
  assert.equal(pages[1][0].top, pages[0][0].top, "each page starts at its top margin");
});

test("a form feed starts a new page; one at the end adds no blank page", async () => {
  const output = await convert("Page one\n\fPage two\fPage three\f\n\n");
  const pages = await pdfPages(output.buffer);
  assert.deepEqual(pages.map((page) => page.map((line) => line.text)), [["Page one"], ["Page two"], ["Page three"]]);
});

test("Greek and Cyrillic load the Unicode font once and come out as real text", async () => {
  fontLoads = 0;
  const output = await convert("Latin first, then:\nΓρήγορη καφέ αλεπού\n    Съешь же ещё этих мягких булок\n");
  assert.equal(fontLoads, 1);
  const source = new TextDecoder("latin1").decode(output.buffer);
  assert.equal(source.match(/\/FontFile2/g)?.length, 1, "the font is embedded once");
  const [page] = await pdfPages(output.buffer);
  assert.deepEqual(new Set(page.map((line) => line.font)), new Set(["sans-serif"]), "the whole file is in one font");
  assert.deepEqual(page.map((line) => line.text), [
    "Latin first, then:",
    "Γρήγορη καφέ αλεπού",
    "Съешь же ещё этих мягких булок",
  ]);
  // Indentation is Courier's columns in either font.
  assert.equal(page[2].x, MARGIN + 24);
});

test("a Hebrew line reads right to left against the right margin; an Arabic one is joined", async () => {
  const output = await convert("שלום עולם 123\nمرحبا بالعالم\nEnglish: עברית\n");
  const [page] = await pdfPages(output.buffer);
  // pdf.js reads right-to-left text back in typed order: a line drawn
  // backwards would come out reversed.
  assert.equal(page[0].text, "שלום עולם 123");
  assert.equal(page[0].end, Math.round(PAGE.width - MARGIN));
  assert.equal(page[1].text.normalize("NFKC"), "مرحبا بالعالم");
  assert.equal(page[1].end, Math.round(PAGE.width - MARGIN));
  // A line that starts in Latin stays left to right, at the left margin.
  assert.equal(page[2].x, MARGIN);
});

test("text the font can't show is refused with a clear message, never a garbled PDF", async () => {
  for (const [text, shown] of [
    ["Hello\n東京は晴れ\n", "“東”, “京”, “は”, “晴”, “れ”"],
    ["Good morning 😀\n", "“😀”"],
    ["ภาษาไทย", "“ภ”"],
    // The font has these, but jsPDF can't set them: Lao's marks need
    // placing, N'Ko's letters and Kurdish's ڕ and ە joining. A mark is
    // shown on a dotted circle.
    ["ພາສາລາວ", "“ພ”, “າ”, “ສ”, “ລ”, “ວ”"],
    ["ߒߞߏ", "“ߒ”, “ߞ”, “ߏ”"],
    ["کوردی ڕە", "“ڕ”, “ە”"],
    [`x${String.fromCharCode(0xeb4)}`, `“${String.fromCharCode(0x25cc, 0xeb4)}”`],
  ]) {
    await assert.rejects(convert(text), (error) => {
      assert.ok(error instanceof TextPdfError);
      assert.equal(error.code, "unsupported_script");
      assert.ok(error.message.includes(`The PDF can't show ${shown}`), error.message);
      assert.match(error.message, /Convert the text to PNG instead/);
      return true;
    });
  }
  // An XML file is told the same, without the TXT advice.
  await assert.rejects(convert("<a>東京</a>", "xml"), (error) => {
    assert.equal(error.code, "unsupported_script");
    assert.doesNotMatch(error.message, /PNG/);
    return true;
  });
});

test("invisible characters go, and an accent typed as a mark joins its letter in Courier", async () => {
  const zwsp = String.fromCharCode(0x200b);
  const soft = String.fromCharCode(0xad);
  const [zwnj, zwj] = [0x200c, 0x200d].map((code) => String.fromCharCode(code));
  assert.equal(printable(`a${zwsp}b${soft}c\u0085d`), "abcd");
  // The joiners stay for the Unicode font; Courier drops them.
  assert.equal(printable(`a${zwnj}b${zwj}c`), `a${zwnj}b${zwj}c`);
  fontLoads = 0;
  const output = await convert(`café ${zwsp}x${zwnj}y${zwj}z\n${zwnj}\n`);
  assert.equal(fontLoads, 0, "é composed is in Windows-1252, and the joiners need no font");
  assert.deepEqual(texts(await pdfPages(output.buffer)), ["café xyz"]);
  await assert.rejects(convert(`${zwnj}\n${zwj}`), { code: "no_text" });
});

const codes = (text) => [...text].map((char) => char.codePointAt(0));

test("a zero-width non-joiner keeps a Persian word's letters apart where it stands", async () => {
  const zwnj = String.fromCharCode(0x200c);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  // می‌خواهم ("I want"): with it, yeh is final and khah initial; without,
  // both are medial and the word is one.
  assert.deepEqual(codes(shapeArabic(doc, `می${zwnj}خواهم`)), [0xfee3, 0xfbfd, 0x200c, 0xfea7, 0xfeee, 0xfe8d, 0xfeeb, 0xfee2]);
  assert.deepEqual(codes(shapeArabic(doc, "میخواهم")), [0xfee3, 0xfbff, 0xfea8, 0xfeee, 0xfe8d, 0xfeeb, 0xfee2]);
  // And so in the PDF, read back (pdf.js reads the final yeh as the letter).
  const read = async (text) => texts(await pdfPages((await convert(text)).buffer))[0];
  assert.deepEqual(codes(await read(`می${zwnj}خواهم`)), [0xfee3, 0x6cc, 0xfea7, 0xfeee, 0xfe8d, 0xfeeb, 0xfee2]);
  assert.deepEqual(codes(await read("میخواهم")), [0xfee3, 0xfbff, 0xfea8, 0xfeee, 0xfe8d, 0xfeeb, 0xfee2]);
});

test("Arabic letters join across vowel marks, a tatweel and a joiner, and never across punctuation or digits", async () => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const [fatha, damma, shadda, zwj] = [0x64e, 0x64f, 0x651, 0x200d].map((code) => String.fromCharCode(code));
  const shaped = (text) => codes(shapeArabic(doc, text));
  // Kaf initial, teh medial and beh final, whatever comes after the word.
  for (const after of ["", "،", "؟", "٣", "!", " "]) {
    assert.deepEqual(shaped(`كتب${after}`).slice(0, 3), [0xfedb, 0xfe98, 0xfe90], after);
  }
  assert.deepEqual(shaped(`ك${fatha}ت${fatha}ب${fatha}`), [0xfedb, 0x64e, 0xfe98, 0x64e, 0xfe90, 0x64e]);
  // A shadda typed before its vowel goes after it, in Unicode's order.
  assert.deepEqual(shaped(`م${damma}ح${fatha}م${shadda}${fatha}د`), [0xfee3, 0x64f, 0xfea4, 0x64e, 0xfee4, 0x64e, 0x651, 0xfeaa]);
  assert.deepEqual(shaped("كـتـب"), [0xfedb, 0x640, 0xfe98, 0x640, 0xfe90]);
  // A joiner joins: heh alone in its initial form.
  assert.deepEqual(shaped(`ه${zwj}`), [0xfeeb, 0x200d]);
  // Lam and alef become one letter, lam's vowel after them.
  assert.deepEqual(codes(doc.processArabic(shapeArabic(doc, `ل${fatha}ا`))), [0xfefb, 0x64e]);
  // Allah stays four letters joined: the font has no U+FDF2.
  assert.deepEqual(shaped("الله"), [0xfe8d, 0xfedf, 0xfee0, 0x200d, 0xfeea]);
  assert.deepEqual(codes(doc.processArabic(shapeArabic(doc, "الله"))), [0xfe8d, 0xfedf, 0xfee0, 0x200d, 0xfeea]);
  assert.equal(shapeArabic(doc, "Ωmega שלום"), "Ωmega שלום");
  // So a file with them converts, and reads back as written.
  for (const line of ["بسم الله الرحمن الرحيم", "كتب، كتب؟ كتب٣"]) {
    const [read] = texts(await pdfPages((await convert(line)).buffer));
    assert.equal(read.normalize("NFKC").replace(/\s+/g, " "), line);
  }
  assert.equal((await convert(`ك${fatha}ت${fatha}ب${fatha}`)).pages, 1);
});

test("an empty or blank file is refused rather than made into a blank PDF", async () => {
  for (const text of ["", "   \n\t\n\f\n", "\u0000\u0001"]) {
    await assert.rejects(convert(text), { name: "TextPdfError", code: "no_text" });
  }
  await assert.rejects(convert(" \n ", "xml"), { name: "TextPdfError", code: "no_text" });
});

test("a file over the size limit is refused before it's read", async () => {
  const size = 50 * 1024 * 1024;
  const huge = {
    size,
    slice: () => new Blob([]),
    arrayBuffer: () => {
      throw new Error("read whole");
    },
  };
  for (const from of ["txt", "xml"]) {
    await assert.rejects(checkInputFile(huge, from, "pdf"), {
      telemetryCode: "too_large",
      telemetryMetadata: { from, to: "pdf", engine: TEXT_PDF_ENGINES[from] },
      message: "This file is 50 MB, over the 20 MB limit for converting to PDF here.",
    });
  }
  assert.equal(tooLargeFileMessage(TEXT_PDF_LIMITS.bytes + 1), "This file is 20.1 MB, over the 20 MB limit for converting to PDF here.");
  // A file's size is rounded up, so one just over the limit never reads as
  // within it.
  const MB = 1024 * 1024;
  for (const bytes of [1, MB / 10 - 1, MB / 10, MB / 10 + 1, 50 * MB].map((over) => TEXT_PDF_LIMITS.bytes + over)) {
    const [size, limit] = tooLargeFileMessage(bytes).match(/[\d,.]+(?= MB)/g).map((value) => Number(value.replaceAll(",", "")));
    assert.ok(size > limit, tooLargeFileMessage(bytes));
  }
  await checkInputFile(huge, "txt", "png");
  // convertTextToPdf checks again, for a caller that didn't.
  await assert.rejects(convert(new ArrayBuffer(TEXT_PDF_LIMITS.bytes + 1)), { code: "too_large" });
});

test("a text that would pass the page limit is refused as soon as it does, never laid out whole", async () => {
  const limits = { pages: 3 };
  await convert("x\n".repeat(3 * LINES_PER_PAGE), "txt", { limits });
  await assert.rejects(convert("x\n".repeat(3 * LINES_PER_PAGE + 1), "txt", { limits }), {
    code: "too_large",
    message: "This file would fill more than 3 pages, the most a PDF made here can have. Split it into smaller files and convert each.",
  });
  // A page break counts its page.
  await assert.rejects(convert("a\fb\fc\fd", "txt", { limits }), { code: "too_large" });
  // Millions of short lines stop at the limit's worth.
  let started = performance.now();
  await assert.rejects(convert("x\n".repeat(5_000_000)), { code: "too_large" });
  assert.ok(performance.now() - started < 5_000, `${performance.now() - started} ms`);
  // A 10 MB line without a space: under the size limit, refused by its
  // pages in Courier. In the Unicode font, at two bytes a letter, it is half
  // as many letters and fits, on about 1,000 pages, in bounded time.
  started = performance.now();
  await assert.rejects(convert("a".repeat(10 * 1024 * 1024)), { code: "too_large", message: /would fill more than 2,000 pages/ });
  assert.ok(performance.now() - started < 10_000, `${performance.now() - started} ms`);
  started = performance.now();
  const cyrillic = await convert("ж".repeat(5 * 1024 * 1024));
  assert.ok(cyrillic.pages > 900 && cyrillic.pages < TEXT_PDF_LIMITS.pages, `${cyrillic.pages} pages`);
  assert.ok(performance.now() - started < 30_000, `${performance.now() - started} ms`);
});

test("blank lines and page breaks at the end don't count towards the page limit", async () => {
  const limits = { pages: 3 };
  // One line and 200 blank lines fill a page; 150 lines of text fill three.
  assert.equal((await convert(`x\n${"\n".repeat(200)}`, "txt", { limits })).pages, 1);
  assert.equal((await convert("x\n".repeat(150), "txt", { limits })).pages, 3);
  assert.equal((await convert(`x${"\n\f".repeat(500)}`, "txt", { limits })).pages, 1);
  // Blank lines between lines of text count.
  assert.equal((await convert(`x${"\n".repeat(3 * LINES_PER_PAGE - 1)}y`, "txt", { limits })).pages, 3);
  await assert.rejects(convert(`x${"\n".repeat(3 * LINES_PER_PAGE)}y`, "txt", { limits }), { code: "too_large" });
  // At the real limits: a line and 130,000 blank lines, 2,000 pages' worth
  // and more, make one page.
  assert.equal((await convert(`x${"\n".repeat(130_000)}`)).pages, 1);
});

test("generated files are refused for their pages exactly when the PDF they make would pass the limit", async () => {
  // Seeded, so a failure repeats: lines of text, lines that wrap, blank and
  // white lines, form feeds, CR LF, and blank lines and page breaks at the
  // end; and XML with elements, comments, long text and blank lines.
  let seed = 283;
  const random = (n) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return Math.floor((seed / 2 ** 31) * n);
  };
  const piece = () => ["", "", " \t ", "\f", "\r", `line ${random(1000)}`, "word ".repeat(10 + random(80)), "x".repeat(random(400))][random(8)];
  const tail = () => ["", "\n".repeat(random(400)), "\f\n".repeat(random(6)), `${" \n".repeat(random(200))}\f${"\n".repeat(random(200))}`][random(4)];
  const element = () => ["<i/>", `<t>${"word ".repeat(random(100))}</t>`, "<!-- a note -->", "<p>a\n\n\nb</p>"][random(4)];
  const files = [
    ...Array.from({ length: 120 }, () => ["txt", Array.from({ length: random(250) }, piece).join("\n") + tail()]),
    ...Array.from({ length: 40 }, () => ["xml", `<r>${Array.from({ length: random(160) }, element).join("")}</r>`]),
  ];
  const limits = { pages: 3 };
  const converted = [];
  const refused = [];
  for (const [from, text] of files) {
    let pages;
    try {
      // The pages it fills with no limit.
      pages = (await convert(text, from, { limits: { pages: Infinity } })).pages;
    } catch (error) {
      assert.equal(error.code, "no_text", JSON.stringify(text.slice(0, 80)));
      continue;
    }
    const outcome = await convert(text, from, { limits }).then((output) => output.pages, (error) => error.code);
    const where = `${from}, ${pages} pages, ending ${JSON.stringify(text.slice(-60))}`;
    if (pages > limits.pages) {
      assert.equal(outcome, "too_large", where);
      refused.push(pages);
    } else {
      assert.equal(outcome, pages, where);
      converted.push(pages);
    }
  }
  // Both sides of the limit, and the limit itself, were tried: no file is
  // refused while one that fills more pages converts.
  assert.ok(converted.length > 20 && refused.length > 20, `${converted.length} converted, ${refused.length} refused`);
  assert.ok(converted.includes(limits.pages));
  assert.ok(Math.max(...converted) < Math.min(...refused));
});

test("a file at the page limit converts, about 2,000 pages in seconds", async () => {
  const line = "The quick brown fox jumps over the lazy dog, again and again and again, to the end.";
  const started = performance.now();
  const output = await convert(`${line.slice(0, COLUMNS)}\n`.repeat(TEXT_PDF_LIMITS.pages * LINES_PER_PAGE));
  assert.equal(output.pages, TEXT_PDF_LIMITS.pages);
  assert.ok(performance.now() - started < 30_000, `${performance.now() - started} ms`);
});

test("wrapText breaks between words, inside a word too long for a line, and stops past its limit", () => {
  const widthOf = () => 1;
  assert.deepEqual(wrapText("aaa bbb ccc", 7, 7, widthOf), ["aaa bbb", "ccc"]);
  assert.deepEqual(wrapText("aaa bbb ccc", 3, 5, widthOf), ["aaa", "bbb", "ccc"]);
  assert.deepEqual(wrapText("abcdefghij", 4, 4, widthOf), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrapText("ab cdefghij", 4, 4, widthOf), ["ab", "cdef", "ghij"]);
  // Spaces never start a line, and a run of them hangs past its end.
  assert.deepEqual(wrapText("ab      cd", 4, 4, widthOf), ["ab", "cd"]);
  // Leading spaces belong to the first line's word.
  assert.deepEqual(wrapText("  abcdef", 4, 4, widthOf), ["  ab", "cdef"]);
  assert.deepEqual(wrapText("", 4, 4, widthOf), [""]);
  assert.deepEqual(wrapText("a".repeat(100), 10, 10, widthOf, 3), ["a".repeat(10), "a".repeat(10), "a".repeat(10), "a".repeat(10)]);
  // A character wider than the line still makes progress, one a line.
  assert.deepEqual(wrapText("WWW", 0.5, 0.5, widthOf), ["W", "W", "W"]);
  // Characters outside the BMP are measured and kept whole.
  assert.deepEqual(wrapText("𝐀𝐁𝐂", 2, 2, widthOf), ["𝐀𝐁", "𝐂"]);
});

test("two files converted at once each come out as their own PDF", async () => {
  const [greek, latin] = await Promise.all([
    convertTextToPdf(encode("Ωmega file\n".repeat(300)), "txt", "greek.txt", { loadFont }),
    convertTextToPdf(encode("Latin file\n".repeat(300)), "txt", "latin.txt", { loadFont }),
  ]);
  assert.deepEqual(new Set(texts(await pdfPages(greek.buffer))), new Set(["Ωmega file"]));
  assert.deepEqual(new Set(texts(await pdfPages(latin.buffer))), new Set(["Latin file"]));
  assert.match(new TextDecoder("latin1").decode(latin.buffer), /\/Title \(latin\)/);
});

// --------------------------------------------------------------------- XML --

const listing = (xml) => {
  const lines = [];
  listXml(xml, (line) => lines.push(`${" ".repeat(line.indent)}${line.text}${line.muted ? " (muted)" : ""}`));
  return lines;
};

test("XML is listed element by element, two columns a level, text beside a tag that holds only it", () => {
  assert.deepEqual(listing(readFileSync(path.join(fixtures, "sample.xml"), "utf8")), [
    '<?xml version="1.0" encoding="UTF-8"?> (muted)',
    "<rows>",
    "  <row>",
    "    <name>Alpha</name>",
    "    <count>1</count>",
    "  </row>",
    "  <row>",
    "    <name>Beta</name>",
    "    <count>2</count>",
    "  </row>",
    "</rows>",
  ]);
  assert.deepEqual(
    listing(
      `<!-- a\n  note --><doc lang="en" note='say "hi"' both="a&quot;b'c">mixed <b>bold</b> text<![CDATA[x < y]]><empty></empty><self/>` +
        "<p>\n  first line\n\n\n  second line\n</p><?render fast?></doc>",
    ),
    [
      "<!-- a (muted)",
      "  note --> (muted)",
      `<doc lang="en" note='say "hi"' both="a&quot;b'c">`,
      "  mixed",
      "  <b>bold</b>",
      "  text",
      "  <![CDATA[x < y]]>",
      "  <empty></empty>",
      "  <self/>",
      "  <p>",
      "    first line",
      "",
      "    second line",
      "  </p>",
      "  <?render fast?> (muted)",
      "</doc>",
    ].map((line) => (line === "" ? "    " : line)),
  );
});

test("XML deeper than 20 levels is listed at the 20th level's indent", () => {
  const depth = 30;
  const xml = `${"<n>".repeat(depth)}deep${"</n>".repeat(depth)}`;
  const lines = [];
  listXml(xml, (line) => lines.push(line));
  assert.equal(Math.max(...lines.map((line) => line.indent)), INDENT * MAX_INDENT_LEVELS);
  assert.deepEqual(lines.find((line) => line.text.includes("deep")), { text: "<n>deep</n>", indent: 40, hang: 4 });
});

test("malformed XML is refused with the parser's message and where it stopped", async () => {
  for (const [xml, reason] of [
    ["<a><b></a>", "line 1, column 10: Unexpected close tag"],
    ["<rows>\n  <row>\n</rows>", "line 3, column 7: Unexpected close tag"],
    ["<a>", "Unclosed root tag"],
    ["<a/><b/>", "A second root element, <b>: an XML document has one."],
    ["<a>x</a>tail", "Text data outside of root node."],
    ["<a x=1/>", "Unquoted attribute value"],
    ["<a>salt & pepper</a>", "Invalid character in entity name"],
    ["<a>&#0;</a>", "Invalid character entity"],
    ["<!-- just a comment -->", "It holds no XML elements."],
  ]) {
    await assert.rejects(convert(xml, "xml"), (error) => {
      assert.ok(error instanceof TextPdfError, xml);
      assert.equal(error.code, "malformed_xml", xml);
      assert.ok(error.message.startsWith("This file isn't well-formed XML, so it can't be listed."), error.message);
      assert.ok(error.message.includes(reason), `${xml}: ${error.message}`);
      return true;
    });
  }
});

test("entities are never expanded: a billion laughs, an external entity and an undeclared one stay as written", async () => {
  const laughs = [
    '<?xml version="1.0"?>',
    "<!DOCTYPE lolz [",
    ' <!ENTITY lol "lol">',
    ...Array.from({ length: 9 }, (_, index) => ` <!ENTITY lol${index + 1} "${`&lol${index || ""};`.repeat(10)}">`),
    ' <!ENTITY xxe SYSTEM "file:///etc/passwd">',
    "]>",
    '<lolz a="&lol9;">&lol9; &xxe; &nbsp; &amp; &#65;&#x42; &constructor;</lolz>',
  ].join("\n");
  const started = performance.now();
  const output = await convert(laughs, "xml");
  assert.ok(performance.now() - started < 2_000);
  assert.equal(output.pages, 1);
  const lines = texts(await pdfPages(output.buffer));
  assert.ok(lines.includes('<lolz a="&lol9;">&lol9; &xxe; &nbsp; & AB &constructor;</lolz>'), lines.join("\n"));
  assert.ok(lines.includes("<!DOCTYPE lolz ["), lines.join("\n"));
  assert.ok(lines.includes('<!ENTITY xxe SYSTEM "file:///etc/passwd">'), lines.join("\n"));
  assert.ok(!lines.join("").includes("lollol"));
});

test("a huge or deeply nested XML file stops at the page limit", async () => {
  const limits = { pages: 2 };
  // Each element is a line: 2 pages hold 122.
  await convert(`<r>${"<i/>".repeat(2 * LINES_PER_PAGE - 2)}</r>`, "xml", { limits });
  await assert.rejects(convert(`<r>${"<i/>".repeat(2 * LINES_PER_PAGE - 1)}</r>`, "xml", { limits }), { code: "too_large" });
  const started = performance.now();
  const deep = 1_000_000;
  await assert.rejects(convert(`${"<a>".repeat(deep)}${"</a>".repeat(deep)}`, "xml"), { code: "too_large" });
  await assert.rejects(convert(`<r>${"<item>Alpha</item>\n".repeat(1_000_000)}</r>`, "xml"), { code: "too_large" });
  assert.ok(performance.now() - started < 10_000, `${performance.now() - started} ms`);
  // A text, comment or CDATA longer than sax's 64 KB buffer is read whole,
  // and the buffer limit is restored after.
  const long = "word ".repeat(30_000);
  const output = await convert(`<r><!--${long}--><![CDATA[${long}]]><t>${long}</t></r>`, "xml");
  assert.ok(output.pages > 1);
  await assert.rejects(convert(`<r>${"<i/>".repeat(1_000_000)}</r>`, "xml"), { code: "too_large" });
});

test("an XML file is read in the encoding it declares, or refused when it can't be", () => {
  const latin1 = Uint8Array.from([...'<?xml version="1.0" encoding="ISO-8859-1"?><a>caf'].map((c) => c.charCodeAt(0)).concat([0xe9], [...'</a>'].map((c) => c.charCodeAt(0))));
  assert.equal(decodeXml(latin1), '<?xml version="1.0" encoding="ISO-8859-1"?><a>café</a>');
  const utf16 = new Uint8Array([0xff, 0xfe, ...[..."<a>Ω</a>"].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
  assert.equal(decodeXml(utf16), "<a>Ω</a>");
  const noBom = new Uint8Array([..."<?xml?><a/>"].flatMap((c) => [c.charCodeAt(0), 0]));
  assert.equal(decodeXml(noBom), "<?xml?><a/>");
  assert.equal(decodeXml(new TextEncoder().encode('<?xml version="1.0" encoding="utf-8"?><a>Ω</a>')), '<?xml version="1.0" encoding="utf-8"?><a>Ω</a>');
  assert.throws(() => decodeXml(new TextEncoder().encode('<?xml version="1.0" encoding="x-made-up"?><a/>')), {
    code: "unsupported_encoding",
    message: "This XML file says it's in x-made-up, which can't be read here. Save it as UTF-8 and convert it again.",
  });
  // Bytes that aren't Shift_JIS, in a file that says they are.
  assert.throws(() => decodeXml(Uint8Array.from([...new TextEncoder().encode('<?xml version="1.0" encoding="Shift_JIS"?><a>'), 0x82, 0xff, 0x3c])), {
    code: "unsupported_encoding",
  });
});

test("the converter page's path: routed, refused with its own codes, anything else a plain try again", async () => {
  const worker = {};
  const result = await convertWithWorker({ worker, from: "xml", to: "pdf", buf: fixture("sample.xml"), fileName: "sample.xml" });
  assert.equal(result.kind, "single");
  assert.ok(texts(await pdfPages(result.buffer)).includes("<name>Alpha</name>"));
  await assert.rejects(convertWithWorker({ worker, from: "xml", to: "pdf", buf: encode("<a>"), fileName: "bad.xml" }), {
    telemetryCode: "malformed_xml",
    telemetryMetadata: { from: "xml", to: "pdf", engine: "xml-pdf" },
  });
  const failure = textPdfFailure(new Error("jsPDF exploded"), "txt");
  assert.equal(failure.telemetryCode, "convert_failed");
  assert.equal(failure.message, "This TXT file couldn't be converted to PDF. Try again, or reload the page.");
  assert.deepEqual(failure.telemetryMetadata, { from: "txt", to: "pdf", engine: "text-pdf" });
  const refusal = textPdfFailure(new TextPdfError("too_large", "Too big."), "xml");
  assert.deepEqual([refusal.telemetryCode, refusal.message], ["too_large", "Too big."]);
});

test("jsPDF and sax load only when a file is converted", () => {
  const source = readFileSync(path.join(appRoot, "lib/convert/workerClient.ts"), "utf8");
  assert.match(source, /await import\("\.\/text-pdf\.ts"\)/);
  for (const file of ["workerClient.ts", "text-pdf-targets.ts"]) {
    const text = readFileSync(path.join(appRoot, "lib/convert", file), "utf8");
    assert.doesNotMatch(text, /^import[^;]*from "(jspdf|sax|\.\/text-pdf\.ts|\.\/xml-listing\.ts)"/m, file);
  }
  assert.doesNotMatch(readFileSync(path.join(appRoot, "lib/convert/text-pdf.ts"), "utf8"), /^import[^;]*from "jspdf"/m);
});

test("the refusal fixtures are the ones make-text-fixtures.mjs writes, and are refused", async () => {
  const made = { "sample-cjk.txt": sampleCjk(), "sample-malformed.xml": sampleMalformedXml() };
  for (const [name, text] of Object.entries(made)) {
    assert.equal(readFileSync(path.join(fixtures, name), "utf8"), text, `${name}: run node benchmarks/make-text-fixtures.mjs`);
  }
  await assert.rejects(convertTextToPdf(fixture("sample-cjk.txt"), "txt", "sample-cjk.txt", { loadFont }), {
    code: "unsupported_script",
    message: /^The PDF can't show “東”, “京”, “は”, “晴”, “れ”, “で” and more: /,
  });
  await assert.rejects(convertTextToPdf(fixture("sample-malformed.xml"), "xml", "sample-malformed.xml", { loadFont }), {
    code: "malformed_xml",
    message: "This file isn't well-formed XML, so it can't be listed. The parser stopped at line 5, column 7: Unexpected close tag",
  });
});

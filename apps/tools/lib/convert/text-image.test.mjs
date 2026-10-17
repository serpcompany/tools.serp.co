import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_LINE_CHARS,
  MAX_TEXT_LINES,
  TEXT_FONT_URL,
  TEXT_LINE_HEIGHT,
  TEXT_MARGIN,
  TEXT_SCALE,
  TEXT_WRAP_WIDTH,
  cleanLine,
  countLines,
  decodeText,
  layoutText,
  textCutNotice,
  textScale,
  wrapLine,
} from "./text-image.ts";
import { MAX_IMAGE_SIDE } from "./document-images.ts";
import { threadCpuMs } from "./test-cpu-time.mjs";

// 10 px a character: 80 characters a line.
const measure = (text) => Array.from(text).length * 10;

test("text is read as UTF-8, UTF-16 by its byte order mark, else Windows-1252", () => {
  const encoder = new TextEncoder();
  assert.equal(decodeText(encoder.encode("héllo")), "héllo");
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("bom")])), "bom");
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])), "hi");
  assert.equal(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69])), "hi");
  // "café" in Windows-1252 isn't valid UTF-8.
  assert.equal(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9])), "café");
});

test("a line drops control characters and terminal colours, and tabs stop every 4 characters", () => {
  assert.equal(cleanLine("\x1b[31mred\x1b[0m text"), "red text");
  assert.equal(cleanLine("a\x00b\x07c"), "abc");
  assert.equal(cleanLine("\tx"), "    x");
  assert.equal(cleanLine("ab\tc"), "ab  c");
  assert.equal(cleanLine("abcd\te"), "abcd    e");
});

test("lines are counted without a final line break", () => {
  assert.equal(countLines("a"), 1);
  assert.equal(countLines("a\nb"), 2);
  assert.equal(countLines("a\nb\n"), 2);
  assert.equal(countLines("a\r\nb\r\n"), 2);
  assert.equal(countLines("a\rb\fc"), 3);
  assert.equal(countLines("a\n\n"), 2);
});

test("a long line wraps between words, and inside a word too long for a line", () => {
  assert.deepEqual(wrapLine("", 100, measure), [""]);
  assert.deepEqual(wrapLine("one two three", 1000, measure), ["one two three"]);
  assert.deepEqual(wrapLine("one two three four", 90, measure), ["one two", "three", "four"]);
  // Indentation stays; spaces at a break don't start the next line.
  assert.deepEqual(wrapLine("  indented words here", 120, measure), ["  indented", "words here"]);
  assert.deepEqual(wrapLine("x".repeat(25), 100, measure), ["xxxxxxxxxx", "xxxxxxxxxx", "xxxxx"]);
  assert.deepEqual(wrapLine(`ab ${"y".repeat(12)}`, 100, measure), ["ab", "yyyyyyyyyy", "yy"]);
  assert.deepEqual(wrapLine("x".repeat(1000), 100, measure, 3), ["xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx"]);
  for (const line of wrapLine("lorem ipsum dolor sit amet ".repeat(40), TEXT_WRAP_WIDTH, measure)) {
    assert.ok(measure(line) <= TEXT_WRAP_WIDTH, line);
  }
});

test("a short text is drawn whole, as wide as its longest line", () => {
  const layout = layoutText("SERP Tools\nAlpha\nBeta\n", measure);
  assert.deepEqual(
    layout.lines.map((line) => line.text),
    ["SERP Tools", "Alpha", "Beta"],
  );
  assert.equal(layout.note, null);
  assert.equal(layout.cutAt, null);
  assert.equal(layout.width, 100 + 2 * TEXT_MARGIN);
  assert.equal(layout.height, 3 * TEXT_LINE_HEIGHT + 2 * TEXT_MARGIN);
  assert.equal(textCutNotice(layout), undefined);
  assert.equal(textScale(layout.width, layout.height), TEXT_SCALE);
});

test("a text of exactly the most lines an image holds isn't cut", () => {
  const text = Array.from({ length: MAX_TEXT_LINES }, (_, index) => `line ${index + 1}`).join("\n");
  const layout = layoutText(text, measure);
  assert.equal(layout.lines.length, MAX_TEXT_LINES);
  assert.equal(layout.note, null);
  assert.ok(layout.height <= MAX_IMAGE_SIDE);
});

test("50,000 lines show what fits in 4096 px and say where they stop", () => {
  const text = Array.from({ length: 50_000 }, (_, index) => `line ${index + 1}`).join("\n");
  const started = threadCpuMs();
  const layout = layoutText(text, measure);
  assert.ok(threadCpuMs() - started < 1000, `took ${threadCpuMs() - started} ms`);
  assert.equal(layout.lines.length, MAX_TEXT_LINES - 1);
  assert.equal(layout.lines.at(-1).text, `line ${MAX_TEXT_LINES - 1}`);
  assert.deepEqual(layout.cutAt, { line: MAX_TEXT_LINES, partial: false });
  assert.equal(layout.total, 50_000);
  assert.equal(layout.note, `… cut before line ${MAX_TEXT_LINES} of 50,000: an image is at most 4,096 px tall.`);
  assert.equal(
    textCutNotice(layout),
    `The text is too long for one image: it stops before line ${MAX_TEXT_LINES} of 50,000, the most a 4,096 px image holds, and its last line says so.`,
  );
  assert.ok(layout.height <= MAX_IMAGE_SIDE, `${layout.height}`);
  const scale = textScale(layout.width, layout.height);
  assert.ok(scale >= 1 && layout.height * scale <= MAX_IMAGE_SIDE);
});

test("one line of 5 MB without a space is cut quickly, part way through", () => {
  const started = threadCpuMs();
  const layout = layoutText("z".repeat(5_000_000), measure);
  assert.ok(threadCpuMs() - started < 2000, `${threadCpuMs() - started} ms`);
  assert.equal(layout.lines.length, MAX_TEXT_LINES - 1);
  assert.deepEqual(layout.cutAt, { line: 1, partial: true });
  assert.match(layout.note, /^… cut part way through line 1 of 1:/);
});

test("a line of characters with no width is still cut, not dropped", () => {
  const layout = layoutText("\u0301".repeat(MAX_LINE_CHARS + 50_000), () => 0);
  assert.deepEqual(layout.cutAt, { line: 1, partial: true });
});

test("tabs in a long line expand in one pass", () => {
  const started = threadCpuMs();
  const line = cleanLine("a\t".repeat(30_000));
  assert.ok(threadCpuMs() - started < 500, `${threadCpuMs() - started} ms`);
  assert.equal(line.length, 120_000);
});

test("a line that wraps past the image's end is cut inside it", () => {
  const text = `${"short\n".repeat(MAX_TEXT_LINES - 3)}${"word ".repeat(200)}\nlast`;
  const layout = layoutText(text, measure);
  assert.equal(layout.lines.length, MAX_TEXT_LINES - 1);
  assert.deepEqual(layout.cutAt, { line: MAX_TEXT_LINES - 2, partial: true });
  assert.equal(layout.lines.at(-1).text, "word word word word word word word word word word word word word word word word");
});

test("Hebrew and Arabic lines are drawn right to left", () => {
  const layout = layoutText("שלום עולם\nhello\nمرحبا", measure);
  assert.deepEqual(
    layout.lines.map((line) => line.rtl),
    [true, false, true],
  );
});

test("text images use the self-hosted DejaVu Sans", () => {
  assert.equal(TEXT_FONT_URL, "/vendor/fonts/dejavu/DejaVuSans.ttf");
});

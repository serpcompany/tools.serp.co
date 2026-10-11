import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fontName, PANGRAM, specimenLines } from "./font-specimen.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");

// A font with one table, `name`, holding the given records:
// [platform, encoding, language, nameId, bytes].
function fontWithNames(records) {
  const strings = records.map((record) => record[4]);
  const nameTable = [];
  const u16 = (value) => [value >> 8, value & 0xff];
  nameTable.push(...u16(0), ...u16(records.length), ...u16(6 + records.length * 12));
  let offset = 0;
  for (const [platform, encoding, language, id, bytes] of records) {
    nameTable.push(...u16(platform), ...u16(encoding), ...u16(language), ...u16(id), ...u16(bytes.length), ...u16(offset));
    offset += bytes.length;
  }
  for (const bytes of strings) nameTable.push(...bytes);
  const u32 = (value) => [...u16(value >>> 16), ...u16(value & 0xffff)];
  const header = [...u32(0x00010000), ...u16(1), ...u16(16), ...u16(0), ...u16(0)];
  const directory = [...u32(0x6e616d65), ...u32(0), ...u32(12 + 16), ...u32(nameTable.length)];
  return Uint8Array.from([...header, ...directory, ...nameTable]);
}
const utf16 = (text) => [...text].flatMap((char) => [0, char.charCodeAt(0)]);
const ascii = (text) => [...text].map((char) => char.charCodeAt(0));

test("fontName reads the full name from the fixture fonts", () => {
  for (const file of ["sample.ttf", "sample.otf"]) {
    assert.equal(fontName(new Uint8Array(readFileSync(path.join(fixtures, file)))), "SERP Sample Regular", file);
  }
});

test("fontName prefers the full name, then English Windows, then Mac Roman", () => {
  assert.equal(
    fontName(fontWithNames([
      [1, 0, 0, 1, ascii("Mac Family")],
      [3, 1, 0x409, 1, utf16("Windows Family")],
      [1, 0, 0, 4, ascii("Mac Full")],
      [3, 1, 0x407, 4, utf16("German Full")],
      [3, 1, 0x409, 4, utf16("English Full")],
    ])),
    "English Full",
  );
  assert.equal(fontName(fontWithNames([[1, 0, 0, 4, ascii("Mac Full")], [3, 1, 0x409, 1, utf16("Family")]])), "Mac Full");
  assert.equal(fontName(fontWithNames([[3, 1, 0x409, 1, utf16("Family\u0000 ")]])), "Family");
});

test("fontName is null for a font without a name, or that isn't a font", () => {
  assert.equal(fontName(fontWithNames([[3, 1, 0x409, 2, utf16("Regular")]])), null);
  assert.equal(fontName(fontWithNames([[3, 0, 0x409, 4, utf16("Symbol encoding")]])), null);
  assert.equal(fontName(new TextEncoder().encode("not a font at all")), null);
  assert.equal(fontName(new Uint8Array(2)), null);
});

test("a specimen shows the name, the letters and digits, then the pangram at five sizes", () => {
  const lines = specimenLines("Example Sans");
  assert.deepEqual(lines[0], { text: "Example Sans", size: 40 });
  assert.deepEqual(lines.filter((line) => line.text === PANGRAM).map((line) => line.size), [16, 24, 32, 48, 64]);
  assert.equal(lines.length, 9);
});

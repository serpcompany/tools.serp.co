import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import opentype from "opentype.js";

import { fontFamilyName, readGlyph, svgToTtf } from "./svg-font.ts";
import { LIMITS } from "./svg-font-shapes.ts";
import { convertWithWorker } from "./workerClient.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const encode = (text) => new TextEncoder().encode(text).buffer;
const svg = (body, root = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`;

// The font, read back by a font parser (opentype.js), and its glyph on U+E000.
async function font(text, name = "icon.svg") {
  const result = await svgToTtf(typeof text === "string" ? encode(text) : text, name);
  const parsed = opentype.parse(result.buffer);
  const glyph = parsed.charToGlyph(String.fromCodePoint(0xe000));
  // opentype.js reads a glyph's points when its path is first asked for.
  void glyph.path;
  return { result, font: parsed, glyph };
}

async function refusal(text, name = "icon.svg") {
  try {
    await svgToTtf(typeof text === "string" ? encode(text) : text, name);
  } catch (error) {
    return error;
  }
  assert.fail("expected the SVG to be refused");
}

// The glyph's outline as polygons in font units (y up), curves sampled.
function polygons(glyph) {
  const result = [];
  let current = null;
  let at = null;
  for (const command of glyph.path.commands) {
    if (command.type === "M") {
      current = [{ x: command.x, y: command.y }];
      result.push(current);
    } else if (command.type === "L") {
      current.push({ x: command.x, y: command.y });
    } else if (command.type === "Q" || command.type === "C") {
      const [c1, c2] = command.type === "Q" ? [{ x: command.x1, y: command.y1 }] : [{ x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }];
      for (let step = 1; step <= 16; step += 1) {
        const t = step / 16;
        const u = 1 - t;
        current.push(
          command.type === "Q"
            ? { x: u * u * at.x + 2 * u * t * c1.x + t * t * command.x, y: u * u * at.y + 2 * u * t * c1.y + t * t * command.y }
            : {
                x: u ** 3 * at.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * command.x,
                y: u ** 3 * at.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * command.y,
              },
        );
      }
    }
    if (command.x !== undefined) at = { x: command.x, y: command.y };
  }
  return result;
}

// Whether a TrueType renderer inks (x, y): its nonzero winding number there.
function inked(glyph, x, y) {
  let winding = 0;
  for (const polygon of polygons(glyph)) {
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
      if (a.y <= y && b.y > y && side > 0) winding += 1;
      else if (a.y > y && b.y <= y && side < 0) winding -= 1;
    }
  }
  return winding !== 0;
}

// A point of a 0 0 24 24 artboard (y down) in font units: the artboard fills
// the em, 1,000 units, from 150 below the baseline.
const at = (x, y, size = 24) => [(x / size) * 1000, ((size - y) / size) * 1000 - 150];
const inkAt = (glyph, x, y, size) => inked(glyph, ...at(x, y, size));

test("an SVG icon becomes one glyph on U+E000, read back by a font parser, in a family named after the file", async () => {
  const bytes = readFileSync(path.join(fixtures, "sample-icon.svg"));
  const { result, font: parsed, glyph } = await font(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "sample-icon.svg");
  assert.equal(parsed.names.fontFamily.en, "sample-icon");
  assert.equal(result.family, "sample-icon");
  assert.equal(parsed.unitsPerEm, 1000);
  assert.deepEqual([parsed.ascender, parsed.descender], [850, -150]);
  assert.notEqual(glyph.index, 0, "U+E000 maps to a glyph, not .notdef");
  assert.equal(glyph.advanceWidth, 1000);
  const contours = glyph.getContours();
  assert.ok(contours.length >= 3 && contours.every((contour) => contour.length >= 3), "the glyph has outlines");
  assert.deepEqual(readGlyph(new Uint8Array(result.buffer)), {
    contours: contours.length,
    points: contours.reduce((sum, contour) => sum + contour.length, 0),
  });
  // The house of sample-icon.svg (viewBox -2 -2 28 28): its walls, roof and
  // chimney are inked; its window (an even-odd hole) and door aren't.
  const house = (x, y) => inkAt(glyph, x + 2, y + 2, 28);
  assert.ok(house(4.5, 20), "wall");
  assert.ok(house(12, 6), "roof");
  assert.ok(house(18, 4.5), "chimney");
  assert.ok(!house(8, 15), "window");
  assert.ok(!house(16, 20), "door");
  assert.ok(!house(1, 20), "outside");
  assert.match(result.notice, /character U\+E000 of the font "sample-icon"/);
});

test("each shape is filled by its own fill rule, and overlapping shapes are all filled", async () => {
  const ring = "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0zM7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z";
  const evenodd = (await font(svg(`<path fill-rule="evenodd" d="${ring}"/>`))).glyph;
  assert.ok(inkAt(evenodd, 4, 12) && !inkAt(evenodd, 12, 12), "even-odd: a ring");
  const sameWay = (await font(svg(`<path d="${ring}"/>`))).glyph;
  assert.ok(inkAt(sameWay, 4, 12) && inkAt(sameWay, 12, 12), "nonzero, both drawn the same way: a disc");
  const opposite = "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0zM7 12a5 5 0 1 1 10 0a5 5 0 1 1 -10 0z";
  const nonzeroHole = (await font(svg(`<path d="${opposite}"/>`))).glyph;
  assert.ok(inkAt(nonzeroHole, 4, 12) && !inkAt(nonzeroHole, 12, 12), "nonzero, drawn opposite ways: a ring");
  // A mirrored circle runs the other way round from the square under it;
  // in one glyph it would cut a hole, but the SVG paints both.
  const overlap = (await font(svg('<rect x="2" y="2" width="20" height="20"/><circle cx="12" cy="12" r="6" transform="scale(-1 1) translate(-24 0)"/>'))).glyph;
  assert.ok(inkAt(overlap, 12, 12) && inkAt(overlap, 4, 4));
  // A ring's hole over another shape is filled by that shape.
  const filledHole = (await font(svg(`<path fill-rule="evenodd" d="${ring}"/><rect x="10" y="10" width="4" height="4"/>`))).glyph;
  assert.ok(inkAt(filledHole, 12, 12) && !inkAt(filledHole, 8.5, 12));
  // Colours are gone: a white shape over a dark one fills in.
  const white = (await font(svg('<rect width="24" height="24"/><circle cx="12" cy="12" r="4" fill="#fff"/>'))).glyph;
  assert.ok(inkAt(white, 12, 12));
});

test("transforms, viewBox offsets and artboards place the icon as a browser draws it", async () => {
  const square = '<rect x="4" y="4" width="8" height="8"/>';
  const nested = (await font(svg(`<g transform="translate(12 0)"><g transform="rotate(90 8 8)">${square}</g></g>`))).glyph;
  assert.ok(inkAt(nested, 20, 8) && !inkAt(nested, 8, 8));
  // An absolute H and V under a rotation (svg-pathdata 9.0.0 turns them
  // wrongly on its own), a skew, and transforms written as browsers read
  // them: without a space between, or with units.
  const rotated = (await font(svg('<path d="M4 4H12V12H4Z" transform="translate(12 0) rotate(90 8 8)"/>'))).glyph;
  assert.deepEqual(Object.values(rotated.getBoundingBox()).map(Math.round), at(16, 12).concat(at(24, 4)).map(Math.round));
  const skewed = (await font(svg('<rect width="8" height="8" transform="translate(4 4)skewX(45)"/>'))).glyph;
  assert.ok(inkAt(skewed, 15, 11) && inkAt(skewed, 6, 5) && !inkAt(skewed, 5, 11));
  const degrees = (await font(svg(`<g transform="translate(12px, 0px) rotate(90deg, 8, 8)">${square}</g>`))).glyph;
  assert.ok(inkAt(degrees, 20, 8) && !inkAt(degrees, 8, 8));
  // A transform a browser can't read is ignored, as a browser ignores it.
  const ignored = (await font(svg(`<g transform="translate(12 0" >${square}</g>`))).glyph;
  assert.ok(inkAt(ignored, 8, 8));
  // The same drawing with its viewBox moved: the same glyph.
  const offset = (await font(svg('<rect x="104" y="104" width="8" height="8"/>', 'viewBox="100 100 24 24"'))).glyph;
  assert.ok(inkAt(offset, 8, 8) && !inkAt(offset, 2, 2) && !inkAt(offset, 14, 14));
  // A width and height of another shape than the viewBox don't stretch it.
  const sized = (await font(svg('<circle cx="12" cy="12" r="12"/>', 'width="300" height="100" viewBox="0 0 24 24"'))).glyph;
  assert.equal(sized.advanceWidth, 1000);
  const box = sized.getBoundingBox();
  assert.ok(Math.abs(box.x2 - box.x1 - (box.y2 - box.y1)) < 4, "still round");
  // A wide artboard makes a wide glyph, as tall as the em.
  const wide = (await font(svg('<rect width="48" height="24"/>', 'viewBox="0 0 48 24"'))).glyph;
  assert.equal(wide.advanceWidth, 2000);
  assert.deepEqual(Object.values(wide.getBoundingBox()).map(Math.round), [0, -150, 2000, 850]);
  // No viewBox: the root's width and height, in their units.
  const points = (await font(svg('<rect width="9" height="9"/>', 'width="18pt" height="18pt"'))).glyph;
  assert.deepEqual(Object.values(points.getBoundingBox()).map(Math.round), [0, 475, 375, 850]);
  // Neither: the drawing's own bounds.
  const bare = (await font(svg('<rect x="50" y="50" width="10" height="20"/>', ""))).glyph;
  assert.equal(bare.advanceWidth, 500);
  // Shapes wholly off the artboard aren't in the glyph.
  const spare = (await font(svg(`${square}<rect x="400" y="400" width="8" height="8"/>`))).glyph;
  assert.equal(spare.getContours().length, 1);
});

test("a shape is filled as its styles say: inherited, from a stylesheet or a style attribute", async () => {
  const filled = async (body, x = 12, y = 12) => inkAt((await font(svg(body))).glyph, x, y);
  const disc = '<circle cx="12" cy="12" r="10"';
  const square = '<rect x="2" y="2" width="4" height="4"/>';
  assert.equal(await filled(`<g fill="none">${disc}/>${square}</g><rect x="20" y="20" width="2" height="2"/>`), false);
  assert.equal(await filled(`<style>.a{fill:none;stroke:#000}</style>${disc} class="a"/>${square}`), false);
  assert.equal(await filled(`<style>.a{fill:none}</style>${disc} class="a" style="fill:red"/>`), true);
  assert.equal(await filled(`${disc} style="fill: none"/>${square}`), false);
  assert.equal(await filled(`${disc} fill-opacity="0"/>${square}`), false);
  assert.equal(await filled(`<g visibility="hidden">${disc}/><rect x="2" y="2" width="4" height="4" visibility="visible"/></g>`), false);
  assert.equal(await filled(`<g opacity="0">${disc}/></g>${square}`), false);
  assert.equal(await filled(`<g display="none">${disc}/></g>${square}`), false);
  // Shapes inside <defs>, <clipPath>, <mask> and <symbol> aren't drawn,
  // unless a <use> draws them.
  assert.equal(await filled(`<defs>${disc} id="d"/></defs><clipPath>${disc}/></clipPath><mask>${disc}/></mask>${square}`), false);
  assert.equal(await filled(`<defs>${disc} id="d"/></defs><use href="#d"/>`), true);
  assert.equal(await filled(`<defs><rect id="r" width="4" height="4"/></defs><use xlink:href="#r" x="10" y="10" xmlns:xlink="http://www.w3.org/1999/xlink"/>`), true);
  const symbol = '<symbol id="s" viewBox="0 0 2 2"><rect width="2" height="2"/></symbol><use href="#s" x="10" y="10" width="4" height="4"/>';
  assert.deepEqual(Object.values((await font(svg(symbol))).glyph.getBoundingBox()).map(Math.round), at(10, 14).concat(at(14, 10)).map(Math.round));
  // A <use> of itself, or of its own group, is drawn once and stops.
  assert.equal(await filled(`<g id="g">${disc}/><use href="#g"/></g><use href="#u" id="u"/>`), true);
});

test("a font holds no strokes: a stroke-only icon is refused with a way out, and a filled shape's stroke is left out", async () => {
  const outline = svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/>', 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"');
  const error = await refusal(outline);
  assert.equal(error.code, "nothing_to_draw");
  assert.match(error.message, /only with strokes.*Outline Stroke/);
  const { result } = await font(svg('<rect x="2" y="2" width="20" height="20" stroke="#000" stroke-width="2"/><line x1="0" y1="0" x2="24" y2="24" stroke="#000"/>'));
  assert.match(result.notice, /Left out, as a font holds filled shapes only: strokes\./);
});

test("text, a picture, or nothing at all gets a plain message", async () => {
  assert.match((await refusal(svg('<text x="2" y="12">Hi</text>'))).message, /only text/);
  assert.match((await refusal(svg('<image href="data:image/png;base64,iVBORw0KGgo=" width="24" height="24"/>'))).message, /only a picture/);
  for (const empty of [svg(""), svg('<rect width="0" height="10"/><path d=""/><polygon points="1 1"/>'), svg('<path d="M2 2L20 2"/>')]) {
    const error = await refusal(empty);
    assert.equal(error.code, "nothing_to_draw");
    assert.equal(error.message, "This SVG has no filled shapes to make a font from.");
  }
  const { result } = await font(svg('<rect width="24" height="24"/><text>Hi</text><image href="x.png" width="4" height="4"/>'));
  assert.match(result.notice, /filled shapes only: text and embedded pictures\./);
});

test("a hostile SVG runs nothing, fetches nothing, and takes bounded time", async () => {
  const originalFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    throw new Error("no network");
  };
  try {
    const { glyph } = await font(
      svg(
        '<script>globalThis.svgFontRan = true</script><rect width="24" height="24"/>' +
          '<image href="https://example.com/x.png" width="4" height="4"/><use href="https://example.com/x.svg#a"/>' +
          '<use href="other.svg#a"/><foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://example.com"/></foreignObject>',
      ),
    );
    assert.ok(inkAt(glyph, 12, 12));
    assert.equal(globalThis.svgFontRan, undefined);
    assert.deepEqual(fetched, []);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const started = Date.now();
  // Billion laughs: entities of entities aren't expanded, so its use fails.
  const laughs =
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol">' +
    Array.from({ length: 9 }, (_, index) => `<!ENTITY lol${index + 1} "${`&lol${index || ""};`.repeat(10)}">`).join("") +
    `]>${svg('<rect width="24" height="24"/><text>&lol9;</text>')}`;
  assert.equal((await refusal(laughs)).code, "unreadable_image");
  // An entity from another file is never read.
  const outside = `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${svg('<rect width="24" height="24" id="&x;"/>')}`;
  assert.equal((await refusal(outside)).code, "unreadable_image");
  // Many uses of a literal entity are bounded too.
  const wide = `<!DOCTYPE svg [<!ENTITY a "${"a".repeat(1000)}">]>${svg(`<rect width="24" height="24" class="${"&a;".repeat(1100)}"/>`)}`;
  assert.equal((await refusal(wide)).code, "too_complex");
  // Path data past what a glyph can hold.
  const huge = `M0 0${"L1 1L2 0".repeat(LIMITS.commands / 2)}Z`;
  assert.equal((await refusal(svg(`<path d="${huge}"/>`))).code, "too_complex");
  // Groups nested past the limit, and a <use> chain past its depth.
  assert.equal((await refusal(svg(`${"<g>".repeat(200)}<rect width="2" height="2"/>${"</g>".repeat(200)}`))).code, "too_complex");
  const chain = Array.from({ length: 40 }, (_, index) => `<g id="u${index}"><use href="#u${index + 1}"/><use href="#u${index + 1}"/></g>`).join("");
  const chained = await refusal(svg(`<defs>${chain}<rect id="u40" width="1" height="1"/></defs><use href="#u0"/>`));
  assert.equal(chained.code, "too_complex");
  // Fan-out through <use>, and text built to make a parser backtrack.
  const fan = Array.from({ length: 12 }, (_, index) => `<g id="f${index}">${`<use href="#f${index + 1}"/>`.repeat(20)}</g>`).join("");
  assert.equal((await refusal(svg(`<defs>${fan}<g id="f12"/></defs><use href="#f0"/>`))).code, "too_complex");
  const slow = [
    svg(`<style>${"/*".repeat(200_000)}</style><rect width="24" height="24"/>`),
    svg(`<style>${"@import x;".repeat(100_000)}</style><rect width="24" height="24"/>`),
    svg(`<rect width="24" height="24" fill="rgba(,${"0".repeat(200_000)}x)"/>`),
    svg(`<rect width="${"1".repeat(200_000)}x" height="24"/><rect width="24" height="24"/>`),
    `${"<!DOCTYPE svg [".repeat(50_000)}${svg('<rect width="24" height="24"/>')}`,
  ];
  for (const text of slow) {
    const before = Date.now();
    await svgToTtf(encode(text), "slow.svg").catch(() => null);
    assert.ok(Date.now() - before < 1_000, `${text.slice(0, 60)}… took ${Date.now() - before} ms`);
  }
  // Over 10 MB is refused unread.
  assert.equal((await refusal(new Uint8Array(10 * 1024 * 1024 + 1).buffer)).code, "too_complex");
  assert.ok(Date.now() - started < 5_000, `refusals took ${Date.now() - started} ms`);
  // Damaged XML, or another kind of file.
  for (const damaged of [svg("<rect>"), "<html><body/></html>", "\x89PNG\r\n\x1a\n", ""]) {
    const error = await refusal(damaged);
    assert.equal(error.code, "unreadable_image", damaged);
    assert.equal(error.message, "This SVG couldn't be read: it may be damaged, or not an SVG file.");
  }
});

test("a 2 MB SVG converts, or is refused as too detailed for a glyph, in seconds", async () => {
  // An icon beside a 2 MB embedded picture.
  const picture = `<image width="24" height="24" href="data:image/png;base64,${"A".repeat(2_000_000)}"/>`;
  let started = Date.now();
  const { glyph, result } = await font(svg(`${picture}<rect x="2" y="2" width="20" height="20"/>`));
  assert.ok(Date.now() - started < 5_000, `took ${Date.now() - started} ms`);
  assert.ok(inkAt(glyph, 12, 12));
  assert.match(result.notice, /filled shapes only: embedded pictures\./);
  // An illustration of 2 MB of curves: more points than one TrueType glyph
  // holds (65,535).
  const paths = [];
  for (let index = 0; paths.join("").length < 2_000_000; index += 1) {
    const x = (index % 40) * 25;
    const y = Math.floor(index / 40) * 25;
    let d = `M${x + 12.5} ${y + 1.5}`;
    for (let step = 1; step <= 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      const r = step % 2 ? 11 : 7.25;
      const point = (offset) =>
        `${(x + 12.5 + r * Math.sin(angle - offset)).toFixed(3)} ${(y + 12.5 - r * Math.cos(angle - offset)).toFixed(3)}`;
      d += `C${point(0.1)} ${point(0.05)} ${point(0)}`;
    }
    paths.push(`<path fill="#${((index * 2654435761) % 0xffffff).toString(16).padStart(6, "0")}" d="${d}Z"/>`);
  }
  started = Date.now();
  const error = await refusal(svg(paths.join("\n"), 'viewBox="0 0 1000 1000"'));
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
  assert.equal(error.code, "too_complex");
  assert.match(error.message, /more detail than a font can hold/);
});

test("Illustrator's entity namespaces, a UTF-16 file and a stylesheet with at-rules are read", async () => {
  const illustrator =
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
    '\t<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">\n\t<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">\n]>\n' +
    '<svg version="1.1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<switch><foreignObject requiredExtensions="&ns_ai;" x="0" y="0" width="1" height="1"><i:pgfRef xlink:href="#a"/></foreignObject>' +
    '<g i:extraneous="self"><style>@media print{.st0{fill:none}} @import url(x.css); .st0{fill:#231F20;}</style><rect class="st0" width="24" height="24"/></g></switch></svg>';
  const { glyph, result } = await font(illustrator);
  assert.ok(inkAt(glyph, 12, 12));
  assert.doesNotMatch(result.notice, /left out/);
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...svg('<rect width="24" height="24"/>')].flatMap((c) => [c.charCodeAt(0), 0])]);
  assert.ok(inkAt((await font(utf16.buffer)).glyph, 12, 12));
});

test("the family is the file's name in plain ASCII, or Icon", () => {
  assert.equal(fontFamilyName("sample-icon.svg"), "sample-icon");
  assert.equal(fontFamilyName("Café Logo (final).svg"), "Cafe Logo final");
  assert.equal(fontFamilyName("アイコン.svg"), "Icon");
  assert.equal(fontFamilyName("🙂 smile.svg"), "smile");
  assert.equal(fontFamilyName("a".repeat(40) + ".svg"), "a".repeat(31));
  assert.equal(fontFamilyName("C:\\icons\\home.SVG"), "home");
});

test("a glyph whose flags don't match its points is caught before it is saved", async () => {
  const { result } = await font(svg('<rect x="2" y="2" width="20" height="20"/>'));
  const bytes = new Uint8Array(result.buffer);
  const glyph = readGlyph(bytes);
  assert.deepEqual(glyph, { contours: 1, points: 4 });
  // Set the repeat bit on the first flag, as svg2ttf's overflowing repeat
  // count leaves a run of more than 255 points.
  const view = new DataView(bytes.buffer);
  const tables = new Map();
  for (let index = 0; index < view.getUint16(4); index += 1) {
    tables.set(String.fromCharCode(...bytes.subarray(12 + index * 16, 16 + index * 16)), view.getUint32(20 + index * 16));
  }
  const long = view.getInt16(tables.get("head") + 50) === 1;
  const start = tables.get("glyf") + (long ? view.getUint32(tables.get("loca") + 4) : view.getUint16(tables.get("loca") + 2) * 2);
  const flags = start + 10 + 2 + 2;
  bytes[flags] |= 8;
  assert.throws(() => readGlyph(bytes), /flags/);
});

test("convertWithWorker makes the font and names it after the upload; a refusal keeps its code", async () => {
  const result = await convertWithWorker({
    worker: undefined,
    from: "svg",
    to: "ttf",
    buf: encode(svg('<rect width="24" height="24"/>')),
    fileName: "my icon.svg",
  });
  assert.equal(result.kind, "single");
  assert.deepEqual([...new Uint8Array(result.buffer, 0, 4)], [0, 1, 0, 0]);
  assert.equal(opentype.parse(result.buffer).names.fontFamily.en, "my icon");
  assert.match(result.notice, /U\+E000/);
  await assert.rejects(
    convertWithWorker({ worker: undefined, from: "svg", to: "ttf", buf: encode(svg('<line x2="9" stroke="red"/>')), fileName: "a.svg" }),
    (error) => error.telemetryCode === "nothing_to_draw" && error.telemetryMetadata.engine === "svg-font" && /strokes/.test(error.message),
  );
});
